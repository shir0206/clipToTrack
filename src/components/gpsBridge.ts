import type { ClipMetadata } from './clipFromMetadata';
import type { Anchor } from './extractGoProMetadata';

/** A clip may be bridged to neighbours at most this far away in time (a tunnel is minutes, not hours). */
const MAX_GAP_MS = 30 * 60 * 1000;

/** Real-fix window of a clip: where it was and when. Fully estimated clips (fixType 0) never act as anchors. */
function span(m: ClipMetadata): { start: Anchor; end: Anchor } | undefined {
  const g = m.gps;
  if (!g.fixType) return undefined;
  const t0 = Date.parse(g.startUtc ?? '');
  const t1 = Date.parse(g.endUtc ?? '');
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return undefined;
  const tr = g.track;
  return {
    start: { lat: g.start.lat, lon: g.start.lon, altM: tr[0]?.altM, utcMs: t0 },
    end: {
      lat: g.end.lat,
      lon: g.end.lon,
      altM: tr[tr.length - 1]?.altM,
      utcMs: t1,
    },
  };
}

/** The clip that ended closest before `t0` and the one that starts closest after `t1`. */
export function pickAnchors(metas: ClipMetadata[], t0: number, t1: number) {
  let prev: Anchor | undefined;
  let next: Anchor | undefined;
  for (const m of metas) {
    const s = span(m);
    if (!s) continue;
    if (
      s.end.utcMs <= t0 &&
      t0 - s.end.utcMs <= MAX_GAP_MS &&
      (!prev || s.end.utcMs > prev.utcMs)
    )
      prev = s.end;
    if (
      s.start.utcMs >= t1 &&
      s.start.utcMs - t1 <= MAX_GAP_MS &&
      (!next || s.start.utcMs < next.utcMs)
    )
      next = s.start;
  }
  return { prev, next };
}
