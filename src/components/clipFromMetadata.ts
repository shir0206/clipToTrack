import type { Clip, DetailGroup, GpsPoint } from './types';
import { ROUTE_COLORS } from './types';

/** Shape of the JSON produced from the "Summary" (+ "GPS Track") tabs. Only fields we read. */
export type { GpsPoint };
export type ClipMetadata = {
  schemaVersion?: number;
  source?: { fileName?: string; fileSizeMB?: number };
  file?: {
    camera?: string;
    createdUtc?: string;
    durationSec?: number;
    frameRate?: number;
    frames?: number;
    videoCodec?: string;
    resolution?: string;
    firmware?: string;
    videoBitrateMbps?: number;
    audio?: string;
  };
  exposure?: {
    iso?: { min: number; max: number };
    shutterOneOverX?: { fastest: number; slowest: number };
    whiteBalanceK?: string;
    droppedFrames?: number;
  };
  motion?: {
    accelMagnitudeMs2?: { max: number };
    gyroMagnitudeMaxRadS?: number;
    gravityNote?: string;
  };
  audio?: { windProcessing?: string; wetMicrophone?: string };
  gps: {
    samples?: number;
    fixType?: number;
    dopMean?: number;
    startUtc?: string;
    endUtc?: string;
    start?: { lat: number; lon: number };
    end?: { lat: number; lon: number };
    totalDistanceM?: number;
    straightLineDistanceM?: number;
    initialBearingDeg?: number;
    altitudeM?: {
      min: number;
      max: number;
      mean?: number;
      changeStartToEnd?: number;
      /** total climbed, from the smoothed altitude track */
      ascentM?: number;
      /** total descended, from the smoothed altitude track */
      descentM?: number;
    };
    speed3dKmh?: { max: number; mean?: number };
    track: GpsPoint[];
  };
};

const isNum = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);

const fmtDuration = (s?: number) => {
  if (!isNum(s)) return '—';
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};
const fmtDistance = (m?: number) =>
  !isNum(m)
    ? '—'
    : m < 1000
      ? `${m.toFixed(1)} m`
      : `${(m / 1000).toFixed(2)} km`;
const fmtSpeed = (kmh?: number) =>
  isNum(kmh) ? `${Math.round(kmh)} km/h` : '—';
const fmtAltitude = (a?: { min: number; max: number }) => {
  if (!a || !isNum(a.min) || !isNum(a.max)) return '—';
  return `${Math.round(a.max)} m`;
};
const fmtDate = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  const day = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${day} · ${time}`;
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const rng = (a?: number, b?: number, f: (n: number) => string = String) =>
  isNum(a) && isNum(b) ? (a === b ? f(a) : `${f(a)}–${f(b)}`) : undefined;

/** Optional extras from the JSON; rows whose source field is missing are dropped. */
function buildDetails(m: ClipMetadata): DetailGroup[] {
  const { file: f, gps: g, source: s, exposure: e, motion: mo, audio: a } = m;
  const delta = g.altitudeM?.changeStartToEnd;
  const raw: [string, [string, string | undefined][]][] = [
    [
      'GPS',
      [
        [
          'Avg speed',
          isNum(g.speed3dKmh?.mean) ? fmtSpeed(g.speed3dKmh!.mean) : undefined,
        ],
        [
          'Straight line',
          isNum(g.straightLineDistanceM)
            ? fmtDistance(g.straightLineDistanceM)
            : undefined,
        ],
        [
          'Heading',
          isNum(g.initialBearingDeg)
            ? `${Math.round(g.initialBearingDeg)}° ${COMPASS[Math.round(g.initialBearingDeg / 45) % 8]}`
            : undefined,
        ],
        [
          'Altitude change',
          isNum(delta)
            ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} m`
            : undefined,
        ],
        [
          'Ascent',
          isNum(g.altitudeM?.ascentM)
            ? `${g.altitudeM!.ascentM.toFixed(1)} m`
            : undefined,
        ],
        [
          'Descent',
          isNum(g.altitudeM?.descentM)
            ? `${g.altitudeM!.descentM.toFixed(1)} m`
            : undefined,
        ],
      ],
    ],
    [
      'Video',
      [
        ['Codec', f?.videoCodec],
        [
          'Bitrate',
          isNum(f?.videoBitrateMbps)
            ? `${f!.videoBitrateMbps} Mbps`
            : undefined,
        ],
        ['Frames', isNum(f?.frames) ? String(f!.frames) : undefined],
        ['File size', isNum(s?.fileSizeMB) ? `${s!.fileSizeMB} MB` : undefined],
        ['Audio', f?.audio],
        ['Firmware', f?.firmware],
      ],
    ],
    [
      'Exposure',
      [
        ['ISO', rng(e?.iso?.min, e?.iso?.max)],
        [
          'Shutter',
          rng(
            e?.shutterOneOverX?.slowest,
            e?.shutterOneOverX?.fastest,
            (n) => `1/${Math.round(n)}`,
          ),
        ],
        [
          'White balance',
          e?.whiteBalanceK ? `${e.whiteBalanceK} K` : undefined,
        ],
        [
          'Dropped frames',
          isNum(e?.droppedFrames) ? String(e!.droppedFrames) : undefined,
        ],
      ],
    ],
    [
      'Motion & audio',
      [
        [
          'Peak accel',
          isNum(mo?.accelMagnitudeMs2?.max)
            ? `${mo!.accelMagnitudeMs2!.max.toFixed(1)} m/s²`
            : undefined,
        ],
        [
          'Peak gyro',
          isNum(mo?.gyroMagnitudeMaxRadS)
            ? `${mo!.gyroMagnitudeMaxRadS} rad/s`
            : undefined,
        ],
        ['Camera tilt', mo?.gravityNote],
        ['Wind', a?.windProcessing],
        ['Wet mic', a?.wetMicrophone],
      ],
    ],
  ];
  return raw
    .map(([title, rows]) => ({
      title,
      rows: rows.filter((r): r is [string, string] => !!r[1]),
    }))
    .filter((grp) => grp.rows.length);
}

/** Validates parsed JSON and converts it into a Clip. Throws an Error with a readable message. */
/**
 * `index` is the display number; `slot` picks the route colour and stays fixed for the clip's lifetime,
 * so deleting other clips never recolours it. Defaults to `index` for callers that don't track slots.
 */
export function clipFromMetadata(raw: unknown, index = 1, slot = index): Clip {
  const m = raw as Partial<ClipMetadata> | null;
  const track = m?.gps?.track;
  if (!Array.isArray(track)) throw new Error('missing gps.track');

  const samples = track.filter(
    (p) =>
      isNum(p?.lat) &&
      isNum(p?.lon) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lon) <= 180,
  );
  const coordinates = samples.map((p) => [p.lon, p.lat] as [number, number]);
  if (coordinates.length < 2)
    throw new Error('needs at least 2 valid GPS points');

  const { file, gps, source } = m as ClipMetadata;
  const fileName = source?.fileName ?? 'clip';
  const resolution =
    file?.resolution?.match(/\(([^)]+)\)/)?.[1] ?? file?.resolution;
  const camera = [
    file?.camera?.replace(/^GoPro\s+/i, ''),
    resolution,
    isNum(file?.frameRate) ? `${file!.frameRate} fps` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const gpsQuality = [
    gps.fixType === 3
      ? '3D fix'
      : isNum(gps.fixType)
        ? `Fix ${gps.fixType}`
        : undefined,
    isNum(gps.dopMean) ? `DOP ${gps.dopMean}` : undefined,
    `${gps.samples ?? coordinates.length} pts`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    id: `${fileName}-${gps.startUtc ?? file?.createdUtc ?? coordinates[0].join(',')}`,
    index,
    title: fileName.replace(/\.[^.]+$/, ''),
    date: fmtDate(gps.startUtc ?? file?.createdUtc),
    color: ROUTE_COLORS[(slot - 1) % ROUTE_COLORS.length],
    duration: fmtDuration(file?.durationSec),
    distance: fmtDistance(gps.totalDistanceM),
    maxSpeed: fmtSpeed(gps.speed3dKmh?.max),
    altitude: fmtAltitude(gps.altitudeM),
    camera,
    gpsQuality,
    coordinates,
    samples,
    addedAt: 0, // overwritten by useClips
    sort: {
      date: Date.parse(gps.startUtc ?? file?.createdUtc ?? '') || undefined,
      duration: isNum(file?.durationSec) ? file!.durationSec : undefined,
      distance: isNum(gps.totalDistanceM) ? gps.totalDistanceM : undefined,
      speed: isNum(gps.speed3dKmh?.max) ? gps.speed3dKmh!.max : undefined,
      altitude:
        isNum(gps.altitudeM?.min) && isNum(gps.altitudeM?.max)
          ? gps.altitudeM!.max - gps.altitudeM!.min
          : undefined,
    },
    details: buildDetails(m as ClipMetadata),
  };
}
