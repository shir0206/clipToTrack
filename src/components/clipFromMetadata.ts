import type { Clip } from './types';
import { ROUTE_COLORS } from './types';

/** Shape of the JSON produced from the "Summary" (+ "GPS Track") tabs. Only fields we read. */
export type GpsPoint = { lat: number; lon: number; altM?: number; speed3dKmh?: number };
export type ClipMetadata = {
  schemaVersion?: number;
  source?: { fileName?: string };
  file?: {
    camera?: string; createdUtc?: string; durationSec?: number; frameRate?: number; resolution?: string;
  };
  gps: {
    samples?: number; fixType?: number; dopMean?: number; startUtc?: string;
    totalDistanceM?: number;
    altitudeM?: { min: number; max: number };
    speed3dKmh?: { max: number };
    track: GpsPoint[];
  };
};

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const fmtDuration = (s?: number) => {
  if (!isNum(s)) return '—';
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};
const fmtDistance = (m?: number) =>
  !isNum(m) ? '—' : m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(2)} km`;
const fmtSpeed = (kmh?: number) => (isNum(kmh) ? `${Math.round(kmh)} km/h` : '—');
const fmtAltitude = (a?: { min: number; max: number }) => {
  if (!a || !isNum(a.min) || !isNum(a.max)) return '—';
  const lo = Math.round(a.min), hi = Math.round(a.max);
  return lo === hi ? `${hi} m` : `${lo}–${hi} m`;
};
const fmtDate = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
};

/** Validates parsed JSON and converts it into a Clip. Throws an Error with a readable message. */
export function clipFromMetadata(raw: unknown, index = 1): Clip {
  const m = raw as Partial<ClipMetadata> | null;
  const track = m?.gps?.track;
  if (!Array.isArray(track)) throw new Error('missing gps.track');

  const coordinates = track
    .filter((p) => isNum(p?.lat) && isNum(p?.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
    .map((p) => [p.lon, p.lat] as [number, number]);
  if (coordinates.length < 2) throw new Error('needs at least 2 valid GPS points');

  const { file, gps, source } = m as ClipMetadata;
  const fileName = source?.fileName ?? 'clip';
  const resolution = file?.resolution?.match(/\(([^)]+)\)/)?.[1] ?? file?.resolution;
  const camera = [
    file?.camera?.replace(/^GoPro\s+/i, ''),
    resolution,
    isNum(file?.frameRate) ? `${file!.frameRate} fps` : undefined,
  ].filter(Boolean).join(' · ');
  const gpsQuality = [
    gps.fixType === 3 ? '3D fix' : isNum(gps.fixType) ? `Fix ${gps.fixType}` : undefined,
    isNum(gps.dopMean) ? `DOP ${gps.dopMean}` : undefined,
    `${gps.samples ?? coordinates.length} pts`,
  ].filter(Boolean).join(' · ');

  return {
    id: `${fileName}-${gps.startUtc ?? file?.createdUtc ?? coordinates[0].join(',')}`,
    index,
    title: fileName.replace(/\.[^.]+$/, ''),
    date: fmtDate(gps.startUtc ?? file?.createdUtc),
    color: ROUTE_COLORS[(index - 1) % ROUTE_COLORS.length],
    duration: fmtDuration(file?.durationSec),
    distance: fmtDistance(gps.totalDistanceM),
    maxSpeed: fmtSpeed(gps.speed3dKmh?.max),
    altitude: fmtAltitude(gps.altitudeM),
    camera,
    gpsQuality,
    coordinates,
  };
}
