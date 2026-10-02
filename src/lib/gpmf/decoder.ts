import {
  TELEMETRY_SCHEMA_VERSION,
  type DecodedTelemetry,
  type GpsPoint,
  type TelemetryScalar,
  type TelemetryStream,
  type TelemetryValue,
  type UnknownGpmfRecord,
} from './types';

const textDecoder = new TextDecoder();
const CONTAINERS = new Set(['DEVC', 'STRM']);
const CONTEXT_KEYS = new Set([
  'TYPE',
  'SCAL',
  'UNIT',
  'SIUN',
  'ORIN',
  'STNM',
  'STMP',
  'TSMP',
  'GPSU',
  'GPSP',
  'GPSF',
  'DVID',
  'DVNM',
  'TICK',
  'TOCK',
  'EMPT',
]);
const STREAM_KEYS = new Set([
  'GPS5',
  'GPS9',
  'ACCL',
  'GYRO',
  'GRAV',
  'CORI',
  'IORI',
  'SHUT',
  'ISOE',
  'WBAL',
  'WRGB',
  'TMPC',
  'LUMA',
  'WNDM',
  'MWET',
  'AALP',
  'ALLD',
  'AUDO',
  'MAGN',
  'HUES',
  'UNIF',
  'SCEN',
  'FACE',
  'FCNM',
  'FACS',
  'PRJT',
  'MTRX',
]);

export class GpmfError extends Error {
  override name = 'GpmfError';
  constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
  }
}

interface RecordHeader {
  key: string;
  type: string;
  structSize: number;
  repeat: number;
  payload: Uint8Array;
  offset: number;
}

interface StreamContext {
  type?: string;
  scale: number[];
  units: string[];
  siUnits: string[];
  orientation?: string;
  name?: string;
  timestampSeconds?: number;
  totalSamples?: number;
  gpsUtc?: string;
  gpsDop?: number;
  gpsFix?: number;
}

function fourCc(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function records(bytes: Uint8Array): RecordHeader[] {
  const result: RecordHeader[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8)
      throw new GpmfError('Truncated GPMF record header', offset);
    const key = fourCc(bytes, offset);
    const typeByte = bytes[offset + 4];
    const structSize = bytes[offset + 5];
    const repeat = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint16(offset + 6);
    const payloadLength = structSize * repeat;
    const paddedLength = (payloadLength + 3) & ~3;
    if (
      !Number.isSafeInteger(payloadLength) ||
      offset + 8 + paddedLength > bytes.length
    )
      throw new GpmfError(`Truncated GPMF payload for ${key}`, offset);
    result.push({
      key,
      type: typeByte === 0 ? '' : String.fromCharCode(typeByte),
      structSize,
      repeat,
      payload: bytes.slice(offset + 8, offset + 8 + payloadLength),
      offset,
    });
    offset += 8 + paddedLength;
  }
  return result;
}

function width(type: string) {
  if ('bBcU'.includes(type)) return 1;
  if ('sS'.includes(type)) return 2;
  if ('lLfqF'.includes(type)) return 4;
  if ('jJdQ'.includes(type)) return 8;
  if (type === 'G') return 16;
  return 0;
}

function scalar(
  type: string,
  bytes: Uint8Array,
  offset: number,
): TelemetryScalar {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (type) {
    case 'b':
      return view.getInt8(offset);
    case 'B':
      return view.getUint8(offset);
    case 's':
      return view.getInt16(offset);
    case 'S':
      return view.getUint16(offset);
    case 'l':
      return view.getInt32(offset);
    case 'L':
      return view.getUint32(offset);
    case 'f':
      return view.getFloat32(offset);
    case 'd':
      return view.getFloat64(offset);
    case 'q':
      return view.getInt32(offset) / 65_536;
    case 'Q':
      return Number(view.getBigInt64(offset)) / 4_294_967_296;
    case 'j': {
      const value = view.getBigInt64(offset);
      return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
        value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : value.toString();
    }
    case 'J': {
      const value = view.getBigUint64(offset);
      return value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : value.toString();
    }
    case 'F':
      return fourCc(bytes, offset);
    case 'G':
      return [...bytes.subarray(offset, offset + 16)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    default:
      throw new GpmfError(`Unsupported GPMF type ${type}`, offset);
  }
}

function decodeText(payload: Uint8Array) {
  return textDecoder.decode(payload).replace(/\0+$/g, '');
}

function decodeValues(
  record: RecordHeader,
  complexType?: string,
): TelemetryValue[] {
  if (record.type === 'c' || record.type === 'U')
    return [decodeText(record.payload)];
  const baseType = record.type === '?' ? (complexType ?? '') : record.type;
  const baseWidth = record.type === '?' ? 0 : width(record.type);
  const types =
    record.type === '?'
      ? baseType
      : baseType.repeat(baseWidth ? record.structSize / baseWidth : 1);
  if (!types)
    throw new GpmfError(
      `Missing TYPE before complex ${record.key}`,
      record.offset,
    );
  const widths: number[] = [...types].map(width);
  if (widths.some((value) => value === 0))
    throw new GpmfError(`Unsupported TYPE definition ${types}`, record.offset);
  const expectedSize = widths.reduce((sum, value) => sum + value, 0);
  if (expectedSize !== record.structSize)
    throw new GpmfError(
      `TYPE size does not match ${record.key}`,
      record.offset,
    );
  const output: TelemetryValue[] = [];
  for (let repetition = 0; repetition < record.repeat; repetition += 1) {
    let offset = repetition * record.structSize;
    const values = [...types].map((type, index) => {
      const value = scalar(type, record.payload, offset);
      offset += widths[index];
      return value;
    });
    output.push(values.length === 1 ? values[0] : values);
  }
  return output;
}

function textChunks(record: RecordHeader) {
  if (record.repeat <= 1) return [decodeText(record.payload)];
  return Array.from({ length: record.repeat }, (_, index) =>
    decodeText(
      record.payload.subarray(
        index * record.structSize,
        (index + 1) * record.structSize,
      ),
    ),
  );
}

function numbers(value: TelemetryValue | undefined) {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(Number);
}

function applyScale(value: TelemetryValue, scale: number[]): TelemetryValue {
  const values = Array.isArray(value) ? value : [value];
  const scaled = values.map((entry, index) => {
    if (typeof entry !== 'number') return entry;
    const divisor = scale[index] ?? scale[0] ?? 1;
    return divisor === 0 || divisor === -1 ? entry : entry / divisor;
  });
  return Array.isArray(value) ? scaled : scaled[0];
}

function applyOrientation(
  value: TelemetryValue,
  orientation?: string,
): TelemetryValue {
  if (
    !orientation ||
    !Array.isArray(value) ||
    orientation.length !== value.length
  )
    return value;
  const oriented: TelemetryScalar[] = new Array(value.length);
  for (let index = 0; index < orientation.length; index += 1) {
    const axis = orientation[index];
    const target = 'XYZ'.indexOf(axis.toUpperCase());
    const entry = value[index];
    if (target < 0 || typeof entry !== 'number') return value;
    oriented[target] = axis === axis.toLowerCase() ? -entry : entry;
  }
  return oriented.some((entry) => entry === undefined) ? value : oriented;
}

function category(key: string): TelemetryStream['category'] {
  if (key === 'GPS5' || key === 'GPS9') return 'gps';
  if (['ACCL', 'GYRO', 'GRAV', 'MAGN'].includes(key)) return 'motion';
  if (['CORI', 'IORI'].includes(key)) return 'orientation';
  if (['SHUT', 'ISOE', 'WBAL', 'WRGB', 'LUMA'].includes(key)) return 'imaging';
  if (['TMPC', 'WNDM', 'MWET'].includes(key)) return 'environment';
  if (['AALP', 'ALLD', 'AUDO'].includes(key)) return 'audio';
  return 'other';
}

function parseUtc(value: string) {
  const match = value.match(
    /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/,
  );
  if (!match) return undefined;
  const seconds = Number(match[6]);
  return new Date(
    Date.UTC(
      2000 + Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Math.floor(seconds),
      Math.round((seconds % 1) * 1000),
    ),
  ).toISOString();
}

function gps9(
  values: number[],
  stream: TelemetryStream,
  context: StreamContext,
): GpsPoint {
  const utcTime =
    values.length >= 7
      ? new Date(
          Date.UTC(2000, 0, 1) + values[5] * 86_400_000 + values[6] * 1000,
        ).toISOString()
      : undefined;
  return {
    latitude: values[0],
    longitude: values[1],
    altitude: values[2],
    speed2d: values[3],
    speed3d: values[4],
    daysSince2000: values[5],
    secondsSinceMidnight: values[6],
    dop: values[7],
    fix: values[8],
    timestampSeconds: context.timestampSeconds,
    utcTime,
    sourceFile: stream.sourceFile,
    sourceSampleIndex: stream.sourceSampleIndex,
  };
}

function decodeBlock(
  bytes: Uint8Array,
  sourceFile: string | undefined,
  sourceSampleIndex: number,
  streams: TelemetryStream[],
  gps: GpsPoint[],
  unknownRecords: UnknownGpmfRecord[],
) {
  const context: StreamContext = { scale: [], units: [], siUnits: [] };
  for (const record of records(bytes)) {
    if (CONTAINERS.has(record.key)) {
      decodeBlock(
        record.payload,
        sourceFile,
        sourceSampleIndex,
        streams,
        gps,
        unknownRecords,
      );
      continue;
    }
    if (record.key === 'TYPE') context.type = decodeText(record.payload);
    else if (record.key === 'SCAL')
      context.scale = decodeValues(record).flatMap(numbers);
    else if (record.key === 'UNIT') context.units = textChunks(record);
    else if (record.key === 'SIUN') context.siUnits = textChunks(record);
    else if (record.key === 'ORIN')
      context.orientation = decodeText(record.payload);
    else if (record.key === 'STNM') context.name = decodeText(record.payload);
    else if (record.key === 'STMP')
      context.timestampSeconds = Number(decodeValues(record)[0]) / 1_000_000;
    else if (record.key === 'TSMP')
      context.totalSamples = Number(decodeValues(record)[0]);
    else if (record.key === 'GPSU')
      context.gpsUtc = parseUtc(decodeText(record.payload));
    else if (record.key === 'GPSP')
      context.gpsDop = Number(decodeValues(record)[0]) / 100;
    else if (record.key === 'GPSF')
      context.gpsFix = Number(decodeValues(record)[0]);
    else if (!CONTEXT_KEYS.has(record.key)) {
      let rawValues: TelemetryValue[];
      try {
        rawValues = decodeValues(record, context.type);
      } catch (error) {
        if (STREAM_KEYS.has(record.key)) throw error;
        rawValues = [];
      }
      const values = rawValues.map((value) =>
        applyOrientation(applyScale(value, context.scale), context.orientation),
      );
      const stream: TelemetryStream = {
        key: record.key,
        name: context.name || record.key,
        category: category(record.key),
        type: record.type === '?' ? (context.type ?? '?') : record.type,
        units: [...context.units],
        siUnits: [...context.siUnits],
        scale: [...context.scale],
        orientation: context.orientation,
        sourceFile,
        sourceSampleIndex,
        timestampSeconds: context.timestampSeconds,
        totalSamples: context.totalSamples,
        values,
        samples: values.map((value, index) => ({
          timestampSeconds: context.timestampSeconds,
          utcTime: record.key === 'GPS5' ? context.gpsUtc : undefined,
          values: value,
          rawValues: rawValues[index],
        })),
      };
      streams.push(stream);
      if (record.key === 'GPS9')
        values.forEach((value) =>
          gps.push(gps9(numbers(value), stream, context)),
        );
      if (record.key === 'GPS5')
        values.forEach((value) => {
          const entry = numbers(value);
          gps.push({
            latitude: entry[0],
            longitude: entry[1],
            altitude: entry[2],
            speed2d: entry[3],
            speed3d: entry[4],
            dop: context.gpsDop,
            fix: context.gpsFix,
            timestampSeconds: context.timestampSeconds,
            utcTime: context.gpsUtc,
            sourceFile,
            sourceSampleIndex,
          });
        });
      if (!STREAM_KEYS.has(record.key))
        unknownRecords.push({
          key: record.key,
          type: record.type,
          structSize: record.structSize,
          repeat: record.repeat,
          sourceFile,
          sourceSampleIndex,
          rawPayload: record.payload,
        });
    }
  }
}

export function decodeGpmfSamples(
  samples: ArrayBuffer[],
  sourceFile?: string,
): DecodedTelemetry {
  const streams: TelemetryStream[] = [];
  const gps: GpsPoint[] = [];
  const unknownRecords: UnknownGpmfRecord[] = [];
  samples.forEach((sample, index) =>
    decodeBlock(
      new Uint8Array(sample),
      sourceFile,
      index,
      streams,
      gps,
      unknownRecords,
    ),
  );
  return { version: TELEMETRY_SCHEMA_VERSION, streams, gps, unknownRecords };
}
