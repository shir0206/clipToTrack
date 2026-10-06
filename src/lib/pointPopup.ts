import type { Clip } from '../types';
import { clipColorStyleText } from './clipColorStyle';

const GPS_EPOCH = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;
const DASH = '—';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const num = (n: unknown, dp: number, grouping = true) =>
  typeof n === 'number' && Number.isFinite(n)
    ? n.toLocaleString('en-US', {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
        useGrouping: grouping,
      })
    : DASH;

const fixLabel = (f?: number) =>
  f === 3
    ? '3D fix'
    : f === 2
      ? '2D fix'
      : f === 0
        ? 'No fix'
        : typeof f === 'number'
          ? `Fix ${f}`
          : DASH;

/** HTML for the hover bubble of clip.samples[i]. Only numbers and escaped strings go in. */
export function pointPopupHtml(clip: Clip, i: number): string {
  const p = clip.samples[i];
  const last = clip.samples.length - 1;
  const tag = i === 0 ? 'Start' : i === last ? 'End' : '';

  // GPS days since 2000 / secs of day are derived from the UTC time (they're the raw form of it)
  const ms = p.utc ? Date.parse(p.utc) : NaN;
  const since = ms - GPS_EPOCH;
  const days = Number.isFinite(since)
    ? String(Math.floor(since / DAY_MS))
    : DASH;
  const secs = Number.isFinite(since)
    ? num((since % DAY_MS) / 1000, 3, false)
    : DASH;
  const utc = p.utc
    ? esc(p.utc.replace('T', ' ').replace('Z', '')) + ' UTC'
    : DASH;

  const cells: [string, string][] = [
    ['Latitude (deg)', num(p.lat, 7)],
    ['Longitude (deg)', num(p.lon, 7)],
    ['Altitude (m)', num(p.altM, 3)],
    ['Speed 2D (m/s)', num(p.speed2dMs, 3)],
    ['Speed 3D (m/s)', num(p.speed3dMs, 3)],
    ['Speed 3D (km/h)', num(p.speed3dKmh, 3)],
    ['Segment dist (m)', num(p.segmentDistM, 4)],
    ['Cumulative dist (m)', num(p.cumulativeDistM, 4)],
    ['DOP', num(p.dop, 2)],
    ['Fix', fixLabel(p.fix)],
    ['GPS days since 2000', days],
    ['GPS secs of day', secs],
  ];

  return `
<div class="point-popup" style="${esc(clipColorStyleText(clip.color))}">
  <div class="popup-header">
    <span class="popup-number">#${p.index ?? i + 1}</span>
    <strong>${esc(clip.title)}</strong>
    ${tag ? `<span class="popup-tag">${tag}</span>` : ''}
  </div>
  <div class="popup-time">${utc}</div>
  <dl class="popup-grid">
    ${cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
  </dl>
</div>`;
}
