import { useId, useMemo, useState, type CSSProperties } from 'react';
import type { Clip, GpsPoint } from '../../types';
import { ENGINE, estimateEngine } from '../../lib/engineModel';
import Icon from '../Icon/Icon';
import './SpeedCluster.css';

type Props = {
  clip: Clip;
  /** index into clip.samples, driven by the map path (hover / click / video playhead); null = nothing yet */
  probe: number | null;
  playback?: {
    playing: boolean;
    onTogglePlay: () => void;
    onStop: () => void;
  };
};

const fin = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const kmh = (p: GpsPoint) =>
  fin(p.speed3dKmh)
    ? p.speed3dKmh
    : fin(p.speed3dMs)
      ? p.speed3dMs * 3.6
      : undefined;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const clamp01 = (n: number) => clamp(n, 0, 1);

/** Speed dial has 6 intervals; pick the smallest "nice" step with a little headroom over the top speed. */
const SPEED_INTERVALS = 6;
const NICE = [5, 10, 15, 20, 25, 30, 40, 50];
const niceStep = (max: number) =>
  NICE.find((n) => n * SPEED_INTERVALS >= max * 1.05) ??
  Math.ceil(max / SPEED_INTERVALS / 10) * 10;

/** Slope (%) and acceleration (m/s²) around sample i, measured over a short window so GPS noise averages out. */
function localMotion(samples: GpsPoint[], i: number) {
  const last = samples.length - 1;
  const dist = (a: number, b: number) =>
    (samples[b].cumulativeDistM ?? NaN) - (samples[a].cumulativeDistM ?? NaN);
  let lo = i;
  let hi = i;
  while (
    (hi - lo < 2 || !(dist(lo, hi) >= 20)) &&
    hi - lo < 20 &&
    (lo > 0 || hi < last)
  ) {
    if (lo > 0) lo--;
    if (hi < last) hi++;
  }
  const a = samples[lo];
  const b = samples[hi];
  const dd = dist(lo, hi);
  const dz = (b.altM ?? NaN) - (a.altM ?? NaN);
  const gradePct = dd >= 20 && fin(dz) ? clamp((dz / dd) * 100, -25, 25) : 0;

  const dt = (Date.parse(b.utc ?? '') - Date.parse(a.utc ?? '')) / 1000;
  const va = kmh(a);
  const vb = kmh(b);
  const accelMs2 =
    dt > 0.3 && va !== undefined && vb !== undefined
      ? clamp((vb - va) / 3.6 / dt, -6, 6)
      : 0;
  return { gradePct, accelMs2 };
}

// dial geometry (SVG user units, viewBox 0 0 200 200; angles in degrees, 0 = 3 o'clock, clockwise)
const START = 135;
const SWEEP = 270;
const polar = (a: number, r: number) => {
  const t = (a * Math.PI) / 180;
  return [100 + r * Math.cos(t), 100 + r * Math.sin(t)] as const;
};
/** arc from fraction f0 to f1 of the sweep */
const arc = (f0: number, f1: number, r: number) => {
  const [x0, y0] = polar(START + SWEEP * f0, r);
  const [x1, y1] = polar(START + SWEEP * f1, r);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${(f1 - f0) * SWEEP > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
};

type Pill = [caption: string, value: string];

export function Dial({
  labels,
  frac,
  title,
  unit,
  redFrom,
  sub = 5,
  pills = [],
  badge = false,
  from = 0,
  tone,
  className = '',
}: {
  labels: string[];
  frac: number;
  title: string;
  unit: string;
  /** fraction (0..1) where the red zone starts */
  redFrom?: number;
  /** minor ticks per labelled interval */
  sub?: number;
  pills?: Pill[];
  badge?: boolean;
  /** fraction (0..1) the value arc starts from; 0.5 gives a centre-zero dial (e.g. climb rate) */
  from?: number;
  /** colours the value arc (used by centre-zero dials: up / down) */
  tone?: 'up' | 'down';
  className?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const f = clamp01(frac);
  const n = labels.length - 1;
  const total = n * sub;

  const ticks = [];
  for (let i = 0; i <= total; i++) {
    const t = i / total;
    const major = i % sub === 0;
    const red = redFrom !== undefined && t >= redFrom - 1e-6;
    const a = START + SWEEP * t;
    const [x0, y0] = polar(a, major ? 75 : 81);
    const [x1, y1] = polar(a, 86);
    ticks.push(
      <line
        key={i}
        className={`${major ? 'major-tick' : 'minor-tick'}${red ? ' redline-tick' : ''}`}
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
      />,
    );
  }

  return (
    <svg
      className={`gauge-dial ${className}`}
      viewBox="0 0 200 200"
      style={{ '--f': f } as CSSProperties}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${uid}-face`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="var(--color-gauge-face-hotspot)" />
          <stop offset="70%" stopColor="var(--color-gauge-face-mid)" />
          <stop offset="100%" stopColor="var(--color-gauge-face-deep)" />
        </radialGradient>
        <linearGradient id={`${uid}-bezel`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-gauge-bezel-light)" />
          <stop offset="35%" stopColor="var(--color-gauge-bezel-mid)" />
          <stop offset="65%" stopColor="var(--color-gauge-bezel-dark)" />
          <stop offset="100%" stopColor="var(--color-gauge-bezel-edge)" />
        </linearGradient>
        <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="var(--color-brand-white)"
            stopOpacity="0.1"
          />
          <stop
            offset="100%"
            stopColor="var(--color-brand-white)"
            stopOpacity="0"
          />
        </linearGradient>
        <radialGradient id={`${uid}-hub`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="var(--color-gauge-hub-light)" />
          <stop offset="45%" stopColor="var(--color-gauge-hub-mid)" />
          <stop offset="100%" stopColor="var(--color-gauge-hub-dark)" />
        </radialGradient>
      </defs>

      <circle
        className="gauge-bezel"
        cx="100"
        cy="100"
        r="97.5"
        stroke={`url(#${uid}-bezel)`}
      />
      <circle
        className="gauge-face"
        cx="100"
        cy="100"
        r="95.5"
        fill={`url(#${uid}-face)`}
      />
      <ellipse
        cx="100"
        cy="54"
        rx="68"
        ry="40"
        fill={`url(#${uid}-sheen)`}
        pointerEvents="none"
      />

      <path className="gauge-track" d={arc(0, 1, 91)} />
      {redFrom !== undefined && (
        <path className="gauge-redline" d={arc(redFrom, 1, 91)} />
      )}
      {Math.abs(f - from) > 0.002 && (
        <path
          className={`gauge-fill${tone ? ` is-${tone}` : ''}`}
          d={arc(Math.min(from, f), Math.max(from, f), 91)}
        />
      )}
      {ticks}
      {labels.map((l, i) => {
        const [x, y] = polar(START + (SWEEP * i) / n, 60);
        return (
          <text key={i} className="dial-label" x={x} y={y}>
            {l}
          </text>
        );
      })}

      <text className="gauge-caption" x="100" y="130">
        {title}
      </text>
      <text className="gauge-unit" x="100" y="142">
        {unit}
      </text>

      {pills.map(([cap, val], i) => {
        const x = pills.length === 1 ? 78 : i === 0 ? 50 : 106;
        return (
          <g key={cap} className="gauge-pill">
            <rect x={x} y="156" width="44" height="22" rx="8" />
            <text className="pill-caption" x={x + 22} y="164">
              {cap}
            </text>
            <text className="pill-value" x={x + 22} y="173">
              {val}
            </text>
          </g>
        );
      })}

      {badge && (
        <g className="gauge-badge" transform="translate(100 166) skewX(-22)">
          <rect x="-11" y="-5" width="6" height="10" rx="1" />
          <rect x="-3" y="-5" width="6" height="10" rx="1" />
          <rect x="5" y="-5" width="6" height="10" rx="1" />
        </g>
      )}

      <g className="gauge-needle">
        <polygon points="82,98.2 161,99.5 161,100.5 82,101.8" />
      </g>
      <circle
        className="gauge-hub"
        cx="100"
        cy="100"
        r="9"
        fill={`url(#${uid}-hub)`}
      />
      <circle className="hub-dot" cx="100" cy="100" r="3" />
    </svg>
  );
}

/**
 * Dark instrument cluster fed by the clip's own GPS samples.
 *  - right dial: speedometer (km/h)
 *  - left dial: tachometer from a virtual engine (see engineModel.ts) that combines speed,
 *    altitude (air density), slope and acceleration into RPM + gear
 * It has no controls of its own: it shows the sample picked by `probe`, so the route on the map
 * (hover, click, or the video playhead) is the controller.
 */
export default function SpeedCluster({ clip, probe, playback }: Props) {
  const samples = clip.samples;
  const last = samples.length - 1;

  const stats = useMemo(() => {
    const speeds = samples.map(kmh).filter(fin);
    return { maxSpeed: speeds.length ? Math.max(...speeds) : undefined };
  }, [samples]);

  // keep showing the last probed sample when the pointer leaves the route
  const [held, setHeld] = useState<number | null>(null);
  if (probe !== null && probe !== held) setHeld(probe);
  const idx = probe ?? held;

  if (stats.maxSpeed === undefined)
    return <p className="video-hint is-padded">No speed data in this clip.</p>;

  const step = niceStep(stats.maxSpeed);
  const scale = step * SPEED_INTERVALS;
  const speedLabels = Array.from({ length: SPEED_INTERVALS + 1 }, (_, i) =>
    String(i * step),
  );

  const p = idx !== null ? samples[Math.min(idx, last)] : undefined;
  const v = p ? kmh(p) : undefined;
  const speedFrac = v !== undefined ? v / scale : 0;

  // tachometer: speed + altitude (+ slope / acceleration) -> RPM
  const motion =
    p && idx !== null
      ? localMotion(samples, Math.min(idx, last))
      : { gradePct: 0, accelMs2: 0 };
  const eng = estimateEngine({
    speedKmh: v ?? 0,
    altM: p?.altM ?? 0,
    ...motion,
  });
  const rpmFrac = v !== undefined ? eng.rpm / ENGINE.maxRpm : 0;
  const rpmLabels = Array.from({ length: ENGINE.maxRpm / 1000 + 1 }, (_, i) =>
    String(i),
  );
  const gearText =
    v === undefined ? '--' : eng.gear === 0 ? 'N' : `${eng.gear}`;
  const altText = fin(p?.altM) ? `${Math.round(p!.altM!)} m` : '--';

  const total = samples[last]?.cumulativeDistM;
  const done = p?.cumulativeDistM;
  const distFrac = fin(done) && fin(total) && total > 0 ? done / total : 0;

  return (
    <div
      className="gauge-cluster"
      role="img"
      aria-label={`Speedometer: ${v !== undefined ? Math.round(v) : 'no'} km/h, ${v !== undefined ? Math.round(eng.rpm) : 'no'} rpm`}
    >
      {playback && (
        <div className="gauge-playback-controls" aria-label="Speed playback">
          <button
            className="gauge-playback-button"
            aria-label={`${playback.playing ? 'Pause' : 'Play'} ${clip.title} speed`}
            onClick={playback.onTogglePlay}
            disabled={!clip.videoUrl}
          >
            <Icon name={playback.playing ? 'pause' : 'play'} size={15} />
          </button>
          <button
            className="gauge-playback-button"
            aria-label={`Stop ${clip.title} speed`}
            onClick={playback.onStop}
            disabled={!clip.videoUrl}
          >
            <Icon name="stop" size={15} />
          </button>
        </div>
      )}

      <Dial
        className="gauge-tachometer"
        labels={rpmLabels}
        frac={rpmFrac}
        redFrom={ENGINE.redlineRpm / ENGINE.maxRpm}
        sub={2}
        title="RPM"
        unit="x1000"
        pills={[
          ['ALT', altText],
          ['GEAR', gearText],
        ]}
      />

      <section className="gauge-middle">
        <div className="gauge-segment" aria-hidden="true">
          {Array.from({ length: 12 }, (_, k) => (
            <i
              key={k}
              style={{ '--on': clamp01(speedFrac * 12 - k) } as CSSProperties}
            />
          ))}
        </div>
        <div className="gauge-readout">
          <span className="gauge-label">SPEED</span>
          <div className="gauge-reading">
            <b>{v !== undefined ? Math.round(v) : '--'}</b>
            <span>km/h</span>
          </div>
        </div>
        <div className="gauge-tiles">
          <div className="gauge-tile">
            <span className="tile-icon">
              <Icon name="route" size={20} />
            </span>
            <span className="tile-text">
              <em>Distance</em>
              <b>{fin(done) ? `${Math.round(done)} m` : '--'}</b>
            </span>
          </div>
          <div className="gauge-tile">
            <span className="tile-icon">
              <Icon name="gauge" size={20} />
            </span>
            <span className="tile-text">
              <em>Max speed</em>
              <b>{Math.round(stats.maxSpeed)} km/h</b>
            </span>
          </div>
        </div>
        {idx === null ? (
          <p className="gauge-hint">Hover or play the route on the map</p>
        ) : (
          <div className="gauge-bar" aria-hidden="true">
            <i
              style={
                {
                  '--progress': `${Math.round(distFrac * 100)}%`,
                } as CSSProperties
              }
            />
          </div>
        )}
      </section>

      <Dial
        className="gauge-speedometer"
        labels={speedLabels}
        frac={speedFrac}
        redFrom={5 / 6}
        sub={5}
        title="SPEED"
        unit="km/h"
        badge
      />
    </div>
  );
}
