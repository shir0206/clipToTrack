import { decodeGpmfSamples } from '../gpmf/decoder';
import type { DecodedTelemetry } from '../gpmf/types';

const HEADER_BYTES = 16;
const MAC_EPOCH_SECONDS = 2_082_844_800;
const READ_CHUNK_BYTES = 1024 * 1024;
const MAX_TABLE_BYTES = 64 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 64 * 1024 * 1024;
const MAX_USER_DATA_SCAN_BYTES = 64 * 1024;

export type Mp4ErrorCode =
  | 'CANCELLED'
  | 'INVALID_BOX'
  | 'TRUNCATED_BOX'
  | 'INVALID_OFFSET'
  | 'TELEMETRY_NOT_FOUND';

export class Mp4Error extends Error {
  override name = 'Mp4Error';

  constructor(
    public readonly code: Mp4ErrorCode,
    message: string,
    public readonly offset?: number,
  ) {
    super(message);
  }
}

export interface SampleRange {
  offset: number;
  size: number;
  data?: ArrayBuffer;
}

export interface TrackInfo {
  id: number;
  handlerType: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  sampleEntry?: string;
  samples: SampleRange[];
}

export interface MovieMetadata {
  creationTime?: string;
  cameraModel?: string;
  firmware?: string;
  coordinates?: string;
  userData: Record<string, string>;
}

export interface MovieInfo {
  sourceName?: string;
  durationSeconds: number;
  tracks: TrackInfo[];
  telemetrySamples: Array<SampleRange & { data: ArrayBuffer }>;
  telemetry: DecodedTelemetry;
  telemetryHash: string;
  metadata: MovieMetadata;
}

function telemetryHash(samples: Array<SampleRange & { data: ArrayBuffer }>) {
  let hash = 0xcbf29ce484222325n;
  for (const sample of samples) {
    for (const byte of new Uint8Array(sample.data)) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

export interface ParseOptions {
  signal?: AbortSignal;
  requireTelemetry?: boolean;
  onProgress?: (progress: number) => void;
}

interface BoxHeader {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
  dataOffset: number;
  end: number;
}

class RangeReader {
  constructor(
    private readonly source: Blob,
    private readonly signal?: AbortSignal,
  ) {}

  checkCancelled() {
    if (this.signal?.aborted)
      throw new Mp4Error('CANCELLED', 'MP4 parsing was cancelled');
  }

  async read(offset: number, length: number) {
    this.checkCancelled();
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0
    )
      throw new Mp4Error('INVALID_OFFSET', 'Invalid byte range', offset);
    if (offset + length > this.source.size)
      throw new Mp4Error(
        'INVALID_OFFSET',
        'Byte range extends beyond the file',
        offset,
      );
    const result = new Uint8Array(length);
    for (let written = 0; written < length; written += READ_CHUNK_BYTES) {
      this.checkCancelled();
      const chunkLength = Math.min(READ_CHUNK_BYTES, length - written);
      const buffer = await this.source
        .slice(offset + written, offset + written + chunkLength)
        .arrayBuffer();
      this.checkCancelled();
      if (buffer.byteLength !== chunkLength)
        throw new Mp4Error(
          'TRUNCATED_BOX',
          'The requested byte range is truncated',
          offset + written,
        );
      result.set(new Uint8Array(buffer), written);
    }
    return result;
  }
}

function requireBytes(bytes: Uint8Array, length: number, box: BoxHeader) {
  if (bytes.length < length)
    throw new Mp4Error(
      'TRUNCATED_BOX',
      `${box.type} payload is truncated`,
      box.offset,
    );
}

function fourCc(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function u32(bytes: Uint8Array, offset: number) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset);
}

function u64(bytes: Uint8Array, offset: number) {
  const value = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Mp4Error('INVALID_BOX', 'Box value exceeds safe browser offsets');
  return Number(value);
}

async function readBox(
  reader: RangeReader,
  offset: number,
  parentEnd: number,
): Promise<BoxHeader> {
  if (parentEnd - offset < 8)
    throw new Mp4Error('TRUNCATED_BOX', 'Incomplete MP4 box header', offset);
  const initial = await reader.read(
    offset,
    Math.min(HEADER_BYTES, parentEnd - offset),
  );
  const shortSize = u32(initial, 0);
  const type = fourCc(initial, 4);
  const headerSize = shortSize === 1 ? 16 : 8;
  if (initial.length < headerSize)
    throw new Mp4Error(
      'TRUNCATED_BOX',
      `Incomplete ${type} box header`,
      offset,
    );
  const size =
    shortSize === 0
      ? parentEnd - offset
      : shortSize === 1
        ? u64(initial, 8)
        : shortSize;
  if (size < headerSize)
    throw new Mp4Error(
      'INVALID_BOX',
      `${type} box is smaller than its header`,
      offset,
    );
  const end = offset + size;
  if (!Number.isSafeInteger(end) || end > parentEnd)
    throw new Mp4Error(
      'TRUNCATED_BOX',
      `${type} box extends beyond its parent`,
      offset,
    );
  return {
    type,
    offset,
    size,
    headerSize,
    dataOffset: offset + headerSize,
    end,
  };
}

async function childBoxes(reader: RangeReader, start: number, end: number) {
  const boxes: BoxHeader[] = [];
  let offset = start;
  while (offset < end) {
    const box = await readBox(reader, offset, end);
    boxes.push(box);
    offset = box.end;
  }
  return boxes;
}

function boxOf(boxes: BoxHeader[], type: string) {
  return boxes.find((box) => box.type === type);
}

async function payload(reader: RangeReader, box: BoxHeader) {
  const length = box.end - box.dataOffset;
  if (length > MAX_TABLE_BYTES)
    throw new Mp4Error(
      'INVALID_BOX',
      `${box.type} payload exceeds the parser resource limit`,
      box.offset,
    );
  return reader.read(box.dataOffset, length);
}

function fixed16(value: number) {
  return value / 65_536;
}

function mp4Time(seconds: number) {
  if (!seconds) return undefined;
  return new Date((seconds - MAC_EPOCH_SECONDS) * 1000).toISOString();
}

async function parseMovieHeader(reader: RangeReader, box: BoxHeader) {
  const bytes = await payload(reader, box);
  requireBytes(bytes, 20, box);
  const version = bytes[0];
  requireBytes(bytes, version === 1 ? 32 : 20, box);
  const creation = version === 1 ? u64(bytes, 4) : u32(bytes, 4);
  const timescale = version === 1 ? u32(bytes, 20) : u32(bytes, 12);
  const duration = version === 1 ? u64(bytes, 24) : u32(bytes, 16);
  return {
    durationSeconds: timescale ? duration / timescale : 0,
    creationTime: mp4Time(creation),
  };
}

async function parseTrackHeader(reader: RangeReader, box?: BoxHeader) {
  if (!box) return { id: 0 };
  const bytes = await payload(reader, box);
  requireBytes(bytes, 20, box);
  const version = bytes[0];
  requireBytes(bytes, version === 1 ? 96 : 84, box);
  const id = u32(bytes, version === 1 ? 20 : 12);
  return {
    id,
    width: fixed16(u32(bytes, bytes.length - 8)),
    height: fixed16(u32(bytes, bytes.length - 4)),
  };
}

async function parseMediaHeader(reader: RangeReader, box?: BoxHeader) {
  if (!box) return { durationSeconds: 0 };
  const bytes = await payload(reader, box);
  requireBytes(bytes, 20, box);
  const version = bytes[0];
  requireBytes(bytes, version === 1 ? 32 : 20, box);
  const timescale = u32(bytes, version === 1 ? 20 : 12);
  const duration = version === 1 ? u64(bytes, 24) : u32(bytes, 16);
  return { durationSeconds: timescale ? duration / timescale : 0 };
}

async function parseHandler(reader: RangeReader, box?: BoxHeader) {
  if (!box) return '';
  const bytes = await payload(reader, box);
  requireBytes(bytes, 12, box);
  return fourCc(bytes, 8);
}

async function parseSampleDescription(reader: RangeReader, box?: BoxHeader) {
  if (!box) return undefined;
  const bytes = await payload(reader, box);
  requireBytes(bytes, 8, box);
  return bytes.length >= 16 && u32(bytes, 4) > 0
    ? fourCc(bytes, 12)
    : undefined;
}

async function parseSampleSizes(reader: RangeReader, box?: BoxHeader) {
  if (!box) return [];
  const bytes = await payload(reader, box);
  requireBytes(bytes, 12, box);
  const uniformSize = u32(bytes, 4);
  const count = u32(bytes, 8);
  if (count > MAX_TABLE_BYTES / 4)
    throw new Mp4Error(
      'INVALID_BOX',
      'stsz sample count exceeds the parser resource limit',
      box.offset,
    );
  if (uniformSize) {
    if (uniformSize > MAX_SAMPLE_BYTES)
      throw new Mp4Error(
        'INVALID_BOX',
        'Telemetry sample exceeds the parser resource limit',
        box.offset,
      );
    return Array.from({ length: count }, () => uniformSize);
  }
  if (12 + count * 4 > bytes.length)
    throw new Mp4Error('TRUNCATED_BOX', 'stsz table is truncated', box.offset);
  return Array.from({ length: count }, (_, index) => {
    const size = u32(bytes, 12 + index * 4);
    if (size > MAX_SAMPLE_BYTES)
      throw new Mp4Error(
        'INVALID_BOX',
        'Telemetry sample exceeds the parser resource limit',
        box.offset,
      );
    return size;
  });
}

async function parseChunkOffsets(reader: RangeReader, box?: BoxHeader) {
  if (!box) return [];
  const bytes = await payload(reader, box);
  requireBytes(bytes, 8, box);
  const count = u32(bytes, 4);
  const width = box.type === 'co64' ? 8 : 4;
  if (8 + count * width > bytes.length)
    throw new Mp4Error(
      'TRUNCATED_BOX',
      `${box.type} table is truncated`,
      box.offset,
    );
  return Array.from({ length: count }, (_, index) =>
    width === 8 ? u64(bytes, 8 + index * width) : u32(bytes, 8 + index * width),
  );
}

async function parseSampleToChunk(reader: RangeReader, box?: BoxHeader) {
  if (!box) return [];
  const bytes = await payload(reader, box);
  requireBytes(bytes, 8, box);
  const count = u32(bytes, 4);
  if (8 + count * 12 > bytes.length)
    throw new Mp4Error('TRUNCATED_BOX', 'stsc table is truncated', box.offset);
  const entries = Array.from({ length: count }, (_, index) => ({
    firstChunk: u32(bytes, 8 + index * 12),
    samplesPerChunk: u32(bytes, 12 + index * 12),
    sampleDescriptionIndex: u32(bytes, 16 + index * 12),
  }));
  entries.forEach((entry, index) => {
    if (
      (index === 0 && entry.firstChunk !== 1) ||
      (index > 0 && entry.firstChunk <= entries[index - 1].firstChunk) ||
      entry.samplesPerChunk === 0 ||
      entry.sampleDescriptionIndex === 0
    )
      throw new Mp4Error('INVALID_BOX', 'stsc entries are invalid', box.offset);
  });
  return entries;
}

function mapSamples(
  sizes: number[],
  chunks: number[],
  entries: Array<{
    firstChunk: number;
    samplesPerChunk: number;
    sampleDescriptionIndex: number;
  }>,
) {
  const samples: SampleRange[] = [];
  let sampleIndex = 0;
  let entryIndex = 0;
  for (
    let chunkIndex = 0;
    chunkIndex < chunks.length && sampleIndex < sizes.length;
    chunkIndex += 1
  ) {
    const chunkNumber = chunkIndex + 1;
    while (
      entryIndex + 1 < entries.length &&
      entries[entryIndex + 1].firstChunk <= chunkNumber
    )
      entryIndex += 1;
    const entry = entries[entryIndex];
    if (!entry || entry.firstChunk > chunkNumber)
      throw new Mp4Error(
        'INVALID_OFFSET',
        'stsc does not describe every chunk',
        chunks[chunkIndex],
      );
    let offset = chunks[chunkIndex];
    if (sampleIndex + entry.samplesPerChunk > sizes.length)
      throw new Mp4Error(
        'INVALID_BOX',
        'stsc maps more samples than stsz defines',
        chunks[chunkIndex],
      );
    for (let inChunk = 0; inChunk < entry.samplesPerChunk; inChunk += 1) {
      const size = sizes[sampleIndex++];
      samples.push({ offset, size });
      const nextOffset = offset + size;
      if (!Number.isSafeInteger(nextOffset))
        throw new Mp4Error('INVALID_OFFSET', 'Sample offset overflows', offset);
      offset = nextOffset;
    }
  }
  if (sampleIndex !== sizes.length)
    throw new Mp4Error(
      'INVALID_OFFSET',
      'Sample tables do not map every sample',
    );
  return samples;
}

async function parseTrack(
  reader: RangeReader,
  box: BoxHeader,
): Promise<TrackInfo> {
  const trackChildren = await childBoxes(reader, box.dataOffset, box.end);
  const header = await parseTrackHeader(reader, boxOf(trackChildren, 'tkhd'));
  const media = boxOf(trackChildren, 'mdia');
  if (!media)
    return { id: header.id, handlerType: '', durationSeconds: 0, samples: [] };
  const mediaChildren = await childBoxes(reader, media.dataOffset, media.end);
  const mediaHeader = await parseMediaHeader(
    reader,
    boxOf(mediaChildren, 'mdhd'),
  );
  const handlerType = await parseHandler(reader, boxOf(mediaChildren, 'hdlr'));
  const minf = boxOf(mediaChildren, 'minf');
  let sampleEntry: string | undefined;
  let samples: SampleRange[] = [];
  if (minf) {
    const minfChildren = await childBoxes(reader, minf.dataOffset, minf.end);
    const stbl = boxOf(minfChildren, 'stbl');
    if (stbl) {
      const tables = await childBoxes(reader, stbl.dataOffset, stbl.end);
      sampleEntry = await parseSampleDescription(reader, boxOf(tables, 'stsd'));
      if (sampleEntry === 'gpmd') {
        const sizes = await parseSampleSizes(reader, boxOf(tables, 'stsz'));
        const offsetsBox = boxOf(tables, 'co64') ?? boxOf(tables, 'stco');
        const chunks = await parseChunkOffsets(reader, offsetsBox);
        const entries = await parseSampleToChunk(reader, boxOf(tables, 'stsc'));
        if (sizes.length || chunks.length || entries.length)
          samples = mapSamples(sizes, chunks, entries);
      }
    }
  }
  return {
    ...header,
    handlerType,
    durationSeconds: mediaHeader.durationSeconds,
    sampleEntry,
    samples,
  };
}

function textValue(bytes: Uint8Array) {
  return new TextDecoder()
    .decode(bytes)
    .replace(/^\0+|\0+$/g, '')
    .trim();
}

function userDataValue(type: string, bytes: Uint8Array) {
  const body = type === '©xyz' && bytes.length >= 4 ? bytes.subarray(4) : bytes;
  const value = textValue(body);
  if (value && /^[\x20-\x7e\s]+$/.test(value)) return value;
  return [...body].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseUserData(reader: RangeReader, box?: BoxHeader) {
  const userData: Record<string, string> = {};
  let cameraModel: string | undefined;
  if (!box) return { userData, cameraModel };
  for (const child of await childBoxes(reader, box.dataOffset, box.end)) {
    const bytes = await reader.read(
      child.dataOffset,
      Math.min(child.end - child.dataOffset, MAX_USER_DATA_SCAN_BYTES),
    );
    const readable = new TextDecoder().decode(bytes);
    cameraModel ??= readable.match(/HERO\d+\s+[A-Za-z][A-Za-z ]*[A-Za-z]/)?.[0];
    if (bytes.length <= 4096) {
      userData[child.type] = userDataValue(child.type, bytes);
    }
  }
  return { userData, cameraModel };
}

export async function parseMp4(
  source: Blob,
  options: ParseOptions = {},
): Promise<MovieInfo> {
  const reader = new RangeReader(source, options.signal);
  reader.checkCancelled();
  const topLevel = await childBoxes(reader, 0, source.size);
  const mediaExtents = topLevel
    .filter((box) => box.type === 'mdat')
    .map((box) => ({ start: box.dataOffset, end: box.end }));
  const moov = boxOf(topLevel, 'moov');
  if (!moov) throw new Mp4Error('INVALID_BOX', 'MP4 movie box was not found');
  const movieChildren = await childBoxes(reader, moov.dataOffset, moov.end);
  const movieHeaderBox = boxOf(movieChildren, 'mvhd');
  const movieHeader = movieHeaderBox
    ? await parseMovieHeader(reader, movieHeaderBox)
    : { durationSeconds: 0, creationTime: undefined };
  const tracks: TrackInfo[] = [];
  for (const trackBox of movieChildren.filter((box) => box.type === 'trak'))
    tracks.push(await parseTrack(reader, trackBox));
  const telemetryTrack = tracks.find((track) => track.sampleEntry === 'gpmd');
  if (
    (!telemetryTrack || telemetryTrack.samples.length === 0) &&
    options.requireTelemetry !== false
  )
    throw new Mp4Error(
      'TELEMETRY_NOT_FOUND',
      'No gpmd telemetry track was found',
    );
  const telemetrySamples: Array<SampleRange & { data: ArrayBuffer }> = [];
  const ranges = telemetryTrack?.samples ?? [];
  for (let index = 0; index < ranges.length; index += 1) {
    const sample = ranges[index];
    const sampleEnd = sample.offset + sample.size;
    if (
      !Number.isSafeInteger(sampleEnd) ||
      !mediaExtents.some(
        (extent) => sample.offset >= extent.start && sampleEnd <= extent.end,
      )
    )
      throw new Mp4Error(
        'INVALID_OFFSET',
        'Telemetry sample is outside an mdat box',
        sample.offset,
      );
    const bytes = await reader.read(sample.offset, sample.size);
    telemetrySamples.push({ ...sample, data: bytes.buffer });
    options.onProgress?.((index + 1) / Math.max(1, ranges.length));
  }
  const parsedUserData = await parseUserData(
    reader,
    boxOf(movieChildren, 'udta'),
  );
  const { userData } = parsedUserData;
  const valueFor = (...keys: string[]) =>
    keys.map((key) => userData[key]).find(Boolean);
  const sourceName =
    'name' in source && typeof source.name === 'string'
      ? source.name
      : undefined;
  return {
    sourceName,
    durationSeconds: movieHeader.durationSeconds,
    tracks,
    telemetrySamples,
    telemetry: decodeGpmfSamples(
      telemetrySamples.map((sample) => sample.data),
      sourceName,
    ),
    telemetryHash: telemetryHash(telemetrySamples),
    metadata: {
      creationTime: movieHeader.creationTime,
      cameraModel: parsedUserData.cameraModel ?? valueFor('MODL'),
      firmware: valueFor('FMWR', 'FIRM'),
      coordinates: valueFor('©xyz', 'GPS ', 'LOCI'),
      userData,
    },
  };
}
