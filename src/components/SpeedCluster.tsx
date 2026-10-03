import { useMemo, useState, type CSSProperties } from 'react';
import type { Clip, GpsPoint } from './types';
import './SpeedCluster.css';

type Props = {
  clip: Clip;
  /** index into clip.samples, driven by the map path (hover / click / video playhead); null = nothing yet */
  probe: number | null;
};

const fin = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const kmh = (p: GpsPoint) =>
  fin(p.speed3dKmh)
    ? p.speed3dKmh
    : fin(p.speed3dMs)
      ? p.speed3dMs * 3.6
      : undefined;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Speed dial has 8 intervals; pick the smallest "nice" step that covers the clip's top speed. */
const NICE = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
const niceStep = (max: number) =>
  NICE.find((n) => n * 8 >= max) ?? Math.ceil(max / 8 / 100) * 100;

// dial geometry (SVG user units, viewBox 0 0 200 200; angles in degrees, 0 = 3 o'clock, clockwise)
const START = 135;
const SWEEP = 270;
const polar = (a: number, r: number) => {
  const t = (a * Math.PI) / 180;
  return [100 + r * Math.cos(t), 100 + r * Math.sin(t)] as const;
};
const arc = (f: number, r: number) => {
  const a = SWEEP * f;
  const [x0, y0] = polar(START, r);
  const [x1, y1] = polar(START + a, r);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
};

function Dial({
  labels,
  frac,
  title,
  unit,
  className = '',
}: {
  labels: string[];
  frac: number;
  title: string;
  unit: string;
  className?: string;
}) {
  const f = clamp01(frac);
  const n = labels.length - 1;
  const ticks = [];
  for (let i = 0; i <= n * 2; i++) {
    const major = i % 2 === 0;
    const a = START + (SWEEP * i) / (n * 2);
    const [x0, y0] = polar(a, major ? 79 : 83);
    const [x1, y1] = polar(a, 88);
    ticks.push(
      <line
        key={i}
        className={major ? 'maj' : 'min'}
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
      />,
    );
  }
  return (
    <svg
      className={`ctt-gt-dial ${className}`}
      viewBox="0 0 200 200"
      style={{ '--f': f } as CSSProperties}
      aria-hidden="true"
    >
      <circle className="ctt-gt-face" cx="100" cy="100" r="97" />
      <path className="ctt-gt-track" d={arc(1, 92)} />
      {f > 0.002 && <path className="ctt-gt-fill" d={arc(f, 92)} />}
      {ticks}
      {labels.map((l, i) => {
        const [x, y] = polar(START + (SWEEP * i) / n, 64);
        return (
          <text key={i} className="ctt-gt-lbl" x={x} y={y}>
            {l}
          </text>
        );
      })}
      <text className="ctt-gt-cap" x="100" y="134">
        {title}
      </text>
      <text className="ctt-gt-unit" x="100" y="147">
        {unit}
      </text>
      <g className="ctt-gt-needle">
        <line x1="90" y1="100" x2="160" y2="100" />
      </g>
      <circle className="ctt-gt-hub" cx="100" cy="100" r="5" />
    </svg>
  );
}

/**
 * Dark instrument cluster fed by the clip's own GPS samples (speed, altitude, distance).
 * It has no controls of its own: it shows the sample picked by `probe`, so the route on the map
 * (hover, click, or the video playhead) is the controller.
 */
export default function SpeedCluster({ clip, probe }: Props) {
  const samples = clip.samples;
  const last = samples.length - 1;

  const stats = useMemo(() => {
    const speeds = samples.map(kmh).filter(fin);
    const alts = samples.map((p) => p.altM).filter(fin);
    return {
      maxSpeed: speeds.length ? Math.max(...speeds) : undefined,
      altMin: alts.length ? Math.min(...alts) : undefined,
      altMax: alts.length ? Math.max(...alts) : undefined,
    };
  }, [samples]);

  // keep showing the last probed sample when the pointer leaves the route
  const [held, setHeld] = useState<number | null>(null);
  if (probe !== null && probe !== held) setHeld(probe);
  const idx = probe ?? held;

  if (stats.maxSpeed === undefined)
    return (
      <p className="ctt-hint" style={{ padding: 12 }}>
        No speed data in this clip.
      </p>
    );

  const step = niceStep(stats.maxSpeed);
  const scale = step * 8;
  const speedLabels = Array.from({ length: 9 }, (_, i) => String(i * step));

  const p = idx !== null ? samples[Math.min(idx, last)] : undefined;
  const v = p ? kmh(p) : undefined;
  const speedFrac = v !== undefined ? v / scale : 0;

  const hasAlt = stats.altMin !== undefined && stats.altMax !== undefined;
  const altSpan = hasAlt ? stats.altMax! - stats.altMin! || 1 : 1;
  const altDec = altSpan >= 20 ? 0 : 1;
  const altLabels = hasAlt
    ? Array.from({ length: 5 }, (_, i) =>
        (stats.altMin! + (altSpan * i) / 4).toFixed(altDec),
      )
    : [];
  const altFrac =
    hasAlt && fin(p?.altM) ? (p!.altM! - stats.altMin!) / altSpan : 0;

  const total = samples[last]?.cumulativeDistM;
  const done = p?.cumulativeDistM;
  const distFrac = fin(done) && fin(total) && total > 0 ? done / total : 0;

  return (
    <div
      className="ctt-gt"
      role="img"
      aria-label={`Speedometer: ${v !== undefined ? Math.round(v) : 'no'} km/h`}
    >
      {hasAlt && (
        <Dial
          className="ctt-gt-alt"
          labels={altLabels}
          frac={altFrac}
          title="ALTITUDE"
          unit="m"
        />
      )}

      <section className="ctt-gt-mid">
        <div className="ctt-gt-seg" aria-hidden="true">
          {Array.from({ length: 12 }, (_, k) => (
            <i
              key={k}
              style={{ '--on': clamp01(speedFrac * 12 - k) } as CSSProperties}
            />
          ))}
        </div>
        <div className="ctt-gt-read">
          <b>{v !== undefined ? Math.round(v) : '--'}</b>
          <span>km/h</span>
        </div>
        <div className="ctt-gt-tiles">
          <div>
            <span>Distance</span>
            <b>{fin(done) ? `${Math.round(done)} m` : '--'}</b>
          </div>
          <div>
            <span>Max speed</span>
            <b>{Math.round(stats.maxSpeed)} km/h</b>
          </div>
        </div>
        {idx === null ? (
          <p className="ctt-gt-hint">Hover or play the route on the map</p>
        ) : (
          <div className="ctt-gt-bar" aria-hidden="true">
            <i style={{ width: `${Math.round(distFrac * 100)}%` }} />
          </div>
        )}
      </section>

      <Dial
        className="ctt-gt-speedo"
        labels={speedLabels}
        frac={speedFrac}
        title="SPEED"
        unit="km/h"
      />
    </div>
  );
}
