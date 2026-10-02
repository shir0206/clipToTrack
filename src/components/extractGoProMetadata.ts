import type { ClipMetadata, GpsPoint } from './clipFromMetadata';

/**
 * Extracts GoPro GPS telemetry (GPMF) from an MP4 *in the browser*, without loading the
 * whole file: only the `moov` box and the small `gpmd` telemetry samples are read via
 * Blob.slice(). Supports GPS9 (HERO11+) and GPS5 (HERO5–10).
 * Output matches the ClipMetadata JSON shape used by clipFromMetadata().
 */

// ───────────────────────── MP4 container ─────────────────────────

type Range = { start: number; hdr: number; size: number };
type Box = Range & { type: string };

const fourcc = (dv: DataView, o: number) =>
  String.fromCharCode(
    dv.getUint8(o),
    dv.getUint8(o + 1),
    dv.getUint8(o + 2),
    dv.getUint8(o + 3),
  );

function* kids(dv: DataView, parent: Range): Generator<Box> {
  const end = parent.start + parent.size;
  let o = parent.start + parent.hdr;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    let hdr = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(o + 8));
      hdr = 16;
    } else if (size === 0) size = end - o;
    if (size < hdr) return;
    yield { type: fourcc(dv, o + 4), start: o, hdr, size };
    o += size;
  }
}
const child = (dv: DataView, p: Range | undefined, type: string) => {
  if (!p) return undefined;
  for (const b of kids(dv, p)) if (b.type === type) return b;
};
const path = (dv: DataView, p: Range | undefined, ...types: string[]) =>
  types.reduce<Box | undefined>((acc, t) => child(dv, acc, t), p as Box);

/** Reads the payload of the first top-level box of `type` (moov is at the END of GoPro files). */
async function readTopLevelBox(file: Blob, type: string) {
  let o = 0;
  while (o + 8 <= file.size) {
    const h = new DataView(await file.slice(o, o + 16).arrayBuffer());
    let size = h.getUint32(0);
    let hdr = 8;
    if (size === 1) {
      size = Number(h.getBigUint64(8));
      hdr = 16;
    } else if (size === 0) size = file.size - o;
    if (size < hdr) break;
    if (fourcc(h, 4) === type) return file.slice(o + hdr, o + size).arrayBuffer();
    o += size;
  }
  throw new Error('not a valid MP4 (no moov box)');
}

type Track = {
  handler: string;
  format: string;
  timescale: number;
  duration: number;
  width: number;
  height: number;
  frameDelta: number;
  sampleCount: number;
  samples: { offset: number; size: number }[];
};

function parseTrack(dv: DataView, trak: Box): Track | undefined {
  const mdia = child(dv, trak, 'mdia');
  const mdhd = child(dv, mdia, 'mdhd');
  const hdlr = child(dv, mdia, 'hdlr');
  const stbl = path(dv, mdia, 'minf', 'stbl');
  const stsd = child(dv, stbl, 'stsd');
  const stsz = child(dv, stbl, 'stsz');
  const stsc = child(dv, stbl, 'stsc');
  const stco = child(dv, stbl, 'stco') ?? child(dv, stbl, 'co64');
  const stts = child(dv, stbl, 'stts');
  if (!mdhd || !hdlr || !stsd || !stsz || !stsc || !stco) return undefined;

  const p = (b: Box) => b.start + b.hdr;
  const v1 = dv.getUint8(p(mdhd)) === 1;
  const timescale = dv.getUint32(p(mdhd) + (v1 ? 20 : 12));
  const duration = v1
    ? Number(dv.getBigUint64(p(mdhd) + 24))
    : dv.getUint32(p(mdhd) + 16);

  const entry = p(stsd) + 8; // skip version/flags + entry count
  const format = fourcc(dv, entry + 4);
  const width = dv.getUint16(entry + 32);
  const height = dv.getUint16(entry + 34);

  // sample sizes
  const constSize = dv.getUint32(p(stsz) + 4);
  const sampleCount = dv.getUint32(p(stsz) + 8);
  const sizes: number[] = [];
  for (let i = 0; i < sampleCount; i++)
    sizes.push(constSize || dv.getUint32(p(stsz) + 12 + i * 4));

  // chunk offsets
  const chunkCount = dv.getUint32(p(stco) + 4);
  const is64 = stco.type === 'co64';
  const chunks: number[] = [];
  for (let i = 0; i < chunkCount; i++)
    chunks.push(
      is64
        ? Number(dv.getBigUint64(p(stco) + 8 + i * 8))
        : dv.getUint32(p(stco) + 8 + i * 4),
    );

  // sample → chunk map
  const scCount = dv.getUint32(p(stsc) + 4);
  const sc: { first: number; per: number }[] = [];
  for (let i = 0; i < scCount; i++)
    sc.push({
      first: dv.getUint32(p(stsc) + 8 + i * 12),
      per: dv.getUint32(p(stsc) + 12 + i * 12),
    });

  const samples: Track['samples'] = [];
  let s = 0;
  for (let c = 0; c < chunks.length && s < sizes.length; c++) {
    let per = sc[0]?.per ?? 1;
    for (const e of sc) if (e.first <= c + 1) per = e.per;
    let off = chunks[c];
    for (let k = 0; k < per && s < sizes.length; k++, s++) {
      samples.push({ offset: off, size: sizes[s] });
      off += sizes[s];
    }
  }

  const frameDelta = stts ? dv.getUint32(p(stts) + 12) : 0; // first stts entry delta

  return {
    handler: fourcc(dv, p(hdlr) + 8),
    format,
    timescale,
    duration,
    width,
    height,
    frameDelta,
    sampleCount,
    samples,
  };
}

// ───────────────────────── GPMF ─────────────────────────

const SIZES: Record<string, number> = {
  b: 1, B: 1, c: 1, s: 2, S: 2, l: 4, L: 4, f: 4, d: 8, j: 8, J: 8,
};
function readNum(dv: DataView, o: number, t: string): number {
  switch (t) {
    case 'b': return dv.getInt8(o);
    case 'B': return dv.getUint8(o);
    case 's': return dv.getInt16(o);
    case 'S': return dv.getUint16(o);
    case 'l': return dv.getInt32(o);
    case 'L': return dv.getUint32(o);
    case 'f': return dv.getFloat32(o);
    case 'd': return dv.getFloat64(o);
    case 'j': return Number(dv.getBigInt64(o));
    case 'J': return Number(dv.getBigUint64(o));
    default: return NaN;
  }
}
const readStr = (dv: DataView, o: number, n: number) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    const c = dv.getUint8(o + i);
    if (c) s += String.fromCharCode(c);
  }
  return s;
};

type Klv = { key: string; type: string; size: number; repeat: number; data: number };
function* klvs(dv: DataView, start: number, end: number): Generator<Klv> {
  let o = start;
  while (o + 8 <= end) {
    const type = String.fromCharCode(dv.getUint8(o + 4));
    const size = dv.getUint8(o + 5);
    const repeat = dv.getUint16(o + 6);
    yield { key: fourcc(dv, o), type, size, repeat, data: o + 8 };
    o += 8 + ((size * repeat + 3) & ~3);
  }
}

type RawSample = {
  lat: number; lon: number; alt: number;
  speed2d: number; speed3d: number;
  dop: number; fix: number; utcMs: number | undefined;
};

/** Reads numbers of a KLV as rows of `size/elemSize`-wide tuples (simple types only). */
function readSamples(dv: DataView, k: Klv, types: string): number[][] {
  const rows: number[][] = [];
  for (let r = 0; r < k.repeat; r++) {
    let o = k.data + r * k.size;
    const row: number[] = [];
    for (const t of types) {
      row.push(readNum(dv, o, t));
      o += SIZES[t] ?? 0;
    }
    rows.push(row);
  }
  return rows;
}

function parseGpmf(buf: ArrayBuffer, out: RawSample[], meta: { device?: string }) {
  const dv = new DataView(buf);
  const end = buf.byteLength;
  for (const devc of klvs(dv, 0, end)) {
    if (devc.key !== 'DEVC') continue;
    const devEnd = devc.data + devc.size * devc.repeat;
    for (const strm of klvs(dv, devc.data, devEnd)) {
      if (strm.key === 'DVNM') meta.device ??= readStr(dv, strm.data, strm.size * strm.repeat);
      if (strm.key !== 'STRM') continue;

      let scal: number[] = [1];
      let types = '';
      let gpsu: number | undefined;
      let gpsf = 3;
      let gpsp = NaN;
      let gps5: Klv | undefined;
      let gps9: Klv | undefined;
      for (const k of klvs(dv, strm.data, strm.data + strm.size * strm.repeat)) {
        if (k.key === 'SCAL')
          scal = readSamples(dv, { ...k, size: SIZES[k.type], repeat: k.size * k.repeat / SIZES[k.type] }, k.type).map((r) => r[0]);
        else if (k.key === 'TYPE') types = readStr(dv, k.data, k.size * k.repeat);
        else if (k.key === 'GPSU') {
          const m = readStr(dv, k.data, 16).match(/^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\.(\d+)/);
          if (m) gpsu = Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Math.round(+`0.${m[7]}` * 1000));
        } else if (k.key === 'GPSF') gpsf = readNum(dv, k.data, 'L');
        else if (k.key === 'GPSP') gpsp = readNum(dv, k.data, 'S') / 100;
        else if (k.key === 'GPS5') gps5 = k;
        else if (k.key === 'GPS9') gps9 = k;
      }
      const sc = (row: number[]) => row.map((v, i) => v / (scal[i % scal.length] || 1));

      if (gps9) {
        const rows = readSamples(dv, gps9, types || 'lllllllSS');
        for (const r of rows) {
          const [lat, lon, alt, s2, s3, days, secs, dop, fix] = sc(r);
          out.push({
            lat, lon, alt, speed2d: s2, speed3d: s3, dop, fix: Math.round(fix * (scal[8] || 1)) / (scal[8] || 1),
            utcMs: Date.UTC(2000, 0, 1) + Math.round(days) * 86_400_000 + Math.round(secs * 1000),
          });
        }
      } else if (gps5) {
        const rows = readSamples(dv, gps5, 'lllll');
        rows.forEach((r, i) => {
          const [lat, lon, alt, s2, s3] = sc(r);
          out.push({
            lat, lon, alt, speed2d: s2, speed3d: s3, dop: gpsp, fix: gpsf,
            utcMs: gpsu === undefined ? undefined : gpsu + Math.round((i * 1000) / rows.length),
          });
        });
      }
    }
  }
}

// ───────────────────────── helpers ─────────────────────────

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const haversine = (a: RawSample, b: RawSample) => {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const iso = (ms: number, withMs = true) => {
  const s = new Date(ms).toISOString();
  return withMs ? s : s.replace(/\.\d{3}Z$/, 'Z');
};
const label = (w: number) =>
  w >= 7600 ? '8K' : w >= 5000 ? '5.3K' : w >= 3700 ? '4K' : w >= 2600 ? '2.7K' : w >= 1900 ? '1080p' : w >= 1200 ? '720p' : '';

// ───────────────────────── telemetry reading ─────────────────────────

export type ExtractProgress = { phase: 'index' | 'telemetry'; done: number; total: number };

// GoPro interleaves one small gpmd chunk with ~1 s of video, so the chunks are far apart.
// Merging them into "a few huge slices" would read the whole video, so instead we
//  1) merge chunks that really are close together (<= MAX_GAP) into one slice (<= MAX_RANGE), and
//  2) read the remaining slices in parallel (POOL at a time) instead of one-by-one.
const MAX_GAP = 64 * 1024;
const MAX_RANGE = 4 * 1024 * 1024;
const POOL = 8;

type Item = { offset: number; size: number; idx: number };
type Slice = { start: number; end: number; items: Item[] };

function planSlices(samples: { offset: number; size: number }[]): Slice[] {
  const sorted: Item[] = samples.map((s, idx) => ({ ...s, idx })).sort((a, b) => a.offset - b.offset);
  const out: Slice[] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    const end = it.offset + it.size;
    if (last && it.offset - last.end <= MAX_GAP && end - last.start <= MAX_RANGE) {
      last.items.push(it);
      last.end = Math.max(last.end, end);
    } else out.push({ start: it.offset, end, items: [it] });
  }
  return out;
}

async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

async function readTelemetry(
  file: Blob,
  samples: { offset: number; size: number }[],
  meta: { device?: string },
  onProgress?: (p: ExtractProgress) => void,
): Promise<RawSample[]> {
  const slices = planSlices(samples);
  const perSample: RawSample[][] = samples.map(() => []); // keeps the original time order
  const total = samples.length;
  let done = 0;
  let lastTick = 0;
  onProgress?.({ phase: 'telemetry', done: 0, total });

  await pool(slices, POOL, async (sl) => {
    const buf = await file.slice(sl.start, sl.end).arrayBuffer();
    for (const it of sl.items)
      parseGpmf(buf.slice(it.offset - sl.start, it.offset - sl.start + it.size), perSample[it.idx], meta);
    done += sl.items.length;
    const now = performance.now();
    if (done === total || now - lastTick > 100) {
      lastTick = now; // throttled so the UI isn't re-rendered hundreds of times
      onProgress?.({ phase: 'telemetry', done, total });
    }
  });
  return perSample.flat();
}

// ───────────────────────── public API ─────────────────────────

export async function extractGoProMetadata(file: File, onProgress?: (p: ExtractProgress) => void): Promise<ClipMetadata> {
  onProgress?.({ phase: 'index', done: 0, total: 1 });
  const moov = await readTopLevelBox(file, 'moov');
  const dv = new DataView(moov);
  const root: Box = { type: 'moov', start: 0, hdr: 0, size: moov.byteLength };
  const tracks: Track[] = [];
  for (const b of kids(dv, root))
    if (b.type === 'trak') {
      const t = parseTrack(dv, b);
      if (t) tracks.push(t);
    }

  const video = tracks.find((t) => t.handler === 'vide');
  const gpmd = tracks.find((t) => t.format === 'gpmd');
  if (!gpmd) throw new Error('no GoPro telemetry track (gpmd) — is this an original GoPro file?');

  // mvhd → creation time + fallback duration
  const mvhd = child(dv, root, 'mvhd');
  let createdMs: number | undefined;
  let durationSec: number | undefined;
  if (mvhd) {
    const p = mvhd.start + mvhd.hdr;
    const v1 = dv.getUint8(p) === 1;
    const created = v1 ? Number(dv.getBigUint64(p + 4)) : dv.getUint32(p + 4);
    const ts = dv.getUint32(p + (v1 ? 20 : 12));
    const dur = v1 ? Number(dv.getBigUint64(p + 24)) : dv.getUint32(p + 16);
    if (created) createdMs = (created - 2_082_844_800) * 1000;
    if (ts) durationSec = dur / ts;
  }
  if (video?.timescale) durationSec = video.duration / video.timescale;

  // telemetry samples (a few KB each, ~1 per second of video)
  const gp: { device?: string } = {};
  const raw = await readTelemetry(file, gpmd.samples, gp, onProgress);

  const valid = raw.filter(
    (s) =>
      Number.isFinite(s.lat) && Number.isFinite(s.lon) &&
      Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180 &&
      !(s.lat === 0 && s.lon === 0) && s.fix >= 2,
  );
  if (valid.length < 2)
    throw new Error(raw.length ? 'no GPS lock in this clip (recorded without a 2D/3D fix)' : 'telemetry track has no GPS data (was GPS enabled?)');

  let cum = 0;
  const track: GpsPoint[] = valid.map((s, i) => {
    const seg = i ? haversine(valid[i - 1], s) : 0;
    cum += seg;
    return {
      index: i + 1,
      lat: round(s.lat, 7),
      lon: round(s.lon, 7),
      altM: round(s.alt, 3),
      speed2dMs: round(s.speed2d, 3),
      speed3dMs: round(s.speed3d, 3),
      dop: round(s.dop, 2),
      fix: s.fix,
      ...(s.utcMs !== undefined && { utc: iso(s.utcMs) }),
      speed3dKmh: round(s.speed3d * 3.6, 3),
      segmentDistM: round(seg, 4),
      cumulativeDistM: round(cum, 4),
    };
  });

  const alts = valid.map((s) => s.alt);
  const spd = valid.map((s) => s.speed3d * 3.6);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const dops = valid.map((s) => s.dop).filter(Number.isFinite);
  const first = valid[0];
  const last = valid[valid.length - 1];

  const device = gp.device?.trim();
  const camera = device ? (/^gopro/i.test(device) ? device : `GoPro ${device}`) : 'GoPro';
  const w = video?.width ?? 0;
  const h = video?.height ?? 0;
  const codec = video?.format === 'hvc1' || video?.format === 'hev1' ? 'HEVC (H.265)' : video?.format === 'avc1' ? 'H.264' : video?.format;
  const fps = video?.frameDelta ? round(video.timescale / video.frameDelta, 2) : undefined;

  return {
    schemaVersion: 1,
    source: { fileName: file.name, fileSizeMB: round(file.size / 1_048_576, 1) },
    file: {
      camera,
      ...(createdMs !== undefined && { createdUtc: iso(createdMs, false) }),
      ...(durationSec !== undefined && { durationSec: round(durationSec, 2) }),
      ...(fps !== undefined && { frameRate: fps }),
      ...(video && { frames: video.sampleCount, videoCodec: codec }),
      ...(w && h && { resolution: `${w} x ${h}${label(w) ? ` (${label(w)})` : ''}` }),
    },
    gps: {
      samples: valid.length,
      fixType: Math.min(...valid.map((s) => s.fix)),
      ...(dops.length && { dopMean: round(mean(dops), 2) }),
      ...(first.utcMs !== undefined && { startUtc: iso(first.utcMs), endUtc: iso(last.utcMs ?? first.utcMs) }),
      start: { lat: track[0].lat, lon: track[0].lon },
      end: { lat: track[track.length - 1].lat, lon: track[track.length - 1].lon },
      totalDistanceM: round(cum, 4),
      altitudeM: { min: round(Math.min(...alts), 3), max: round(Math.max(...alts), 3), mean: round(mean(alts), 3) },
      speed3dKmh: { max: round(Math.max(...spd), 3), mean: round(mean(spd), 3) },
      track,
    },
  };
}
