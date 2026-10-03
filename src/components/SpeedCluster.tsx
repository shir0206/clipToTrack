import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Clip, GpsPoint } from './types';
import SvgIcon from './SvgIcon';
import './SpeedCluster.css';

type Props = {
  clip: Clip;
  /** index into clip.samples (shared with the map marker); null = nothing probed */
  probe: number | null;
  onProbe: (i: number | null) => void;
};

const fin = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const kmh = (p: GpsPoint) =>
  fin(p.speed3dKmh)
    ? p.speed3dKmh
    : fin(p.speed3dMs)
      ? p.speed3dMs * 3.6
      : undefined;

/** Speed dial has 8 intervals; pick the smallest "nice" step that covers the clip's top speed. */
const NICE = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
const niceStep = (max: number) =>
  NICE.find((n) => n * 8 >= max) ?? Math.ceil(max / 8 / 100) * 100;

const LED_COLORS = [
  '#5b8dff', '#5b8dff', '#5b8dff',
  '#f07a6e', '#f07a6e', '#f07a6e',
  '#d93232', '#d93232', '#d93232',
];

function indexAt(times: number[], t: number) {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function Dial({
  labels,
  frac,
  top,
  bottom,
  className = '',
}: {
  labels: string[];
  frac: number;
  top: string;
  bottom: string;
  className?: string;
}) {
  const step = 270 / (labels.length - 1);
  const style = {
    '--step': `${step}deg`,
    '--M': `${step / 2}deg`,
    '--m': `${step / 4}deg`,
    '--f': Math.min(1, Math.max(0, frac)),
  } as CSSProperties;
  return (
    <section className={`ctt-gt-dial ${className}`} style={style}>
      <div className="ctt-gt-face">
        <i className="ctt-gt-ticks minor" />
        <i className="ctt-gt-ticks major" />
        {labels.map((l, i) => (
          <span
            key={i}
            className="ctt-gt-n"
            style={{ '--i': i } as CSSProperties}
          >
            {l}
          </span>
        ))}
        <div className="ctt-gt-cap top">{top}</div>
        <div className="ctt-gt-cap bot">{bottom}</div>
        <div className="ctt-gt-needle" />
        <div className="ctt-gt-hub" />
      </div>
    </section>
  );
}

/**
 * GT instrument cluster fed by the clip's own GPS samples:
 * speedometer + digital readout (3D speed), altitude dial, distance and max speed.
 * It follows `probe`, so it stays in sync with the map marker; a play button replays the clip in real time.
 */
export default function SpeedCluster({ clip, probe, onProbe }: Props) {
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

  // ms since the first sample (from the GPS UTC stamps; 10 Hz fallback)
  const times = useMemo(() => {
    const t = samples.map((s) => (s.utc ? Date.parse(s.utc) : NaN));
    const ok = t.length > 1 && t.every(Number.isFinite) && t[last] > t[0];
    return ok ? t.map((x) => x - t[0]) : samples.map((_, i) => i * 100);
  }, [samples, last]);

  // keep showing the last probed sample when the pointer leaves another chart
  const [held, setHeld] = useState<number | null>(null);
  if (probe !== null && probe !== held) setHeld(probe);
  const idx = probe ?? held;

  const [playing, setPlaying] = useState(false);
  const idxRef = useRef(idx);
  const onProbeRef = useRef(onProbe);
  useEffect(() => {
    idxRef.current = idx;
    onProbeRef.current = onProbe;
  });

  useEffect(() => {
    if (!playing) return;
    const from = idxRef.current;
    const t0 = from !== null && from < last ? times[from] : 0;
    const started = performance.now();
    let prev = -1;
    let raf = 0;
    const tick = (now: number) => {
      const t = t0 + (now - started);
      if (t >= times[last]) {
        onProbeRef.current(last);
        setPlaying(false);
        return;
      }
      const i = indexAt(times, t);
      if (i !== prev) {
        prev = i;
        onProbeRef.current(i);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, times, last]);

  if (stats.maxSpeed === undefined)
    return (
      <p className="ctt-hint" style={{ padding: 12 }}>
        No speed data in this clip.
      </p>
    );

  const step = niceStep(stats.maxSpeed);
  const scale = step * 8;
  const speedLabels = Array.from({ length: 9 }, (_, i) => String(i * step));

  const p = idx !== null ? samples[idx] : undefined;
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

  const dist = fin(p?.cumulativeDistM) ? Math.round(p!.cumulativeDistM!) : '--';
  const totalDist = samples[last]?.cumulativeDistM;
  const distFrac =
    fin(p?.cumulativeDistM) && fin(totalDist) && totalDist > 0
      ? p!.cumulativeDistM! / totalDist
      : 0;
  const maxFrac = v !== undefined ? v / stats.maxSpeed : 0;
  // cosmetic, like the HTML cluster: gear and drive mode follow the speed
  const gear = Math.min(6, 1 + Math.floor(speedFrac * 6));
  const mode = speedFrac < 0.34 ? 0 : speedFrac < 0.67 ? 1 : 2;
  const pct = (f: number) => `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`;

  return (
    <div>
      <div
        className="ctt-gt"
        role="img"
        aria-label={`Speedometer: ${v !== undefined ? Math.round(v) : 'no'} km/h`}
      >
        <div className="ctt-gt-dash">
          {hasAlt && (
            <Dial
              className="ctt-gt-alt ctt-gt-tacho"
              labels={altLabels}
              frac={altFrac}
              top="ALT"
              bottom="metres"
            />
          )}

          <section className="ctt-gt-mid">
            <div className="ctt-gt-leds" aria-hidden="true">
              {LED_COLORS.map((c, k) => (
                <i
                  key={k}
                  style={
                    {
                      '--c': c,
                      '--on': Math.min(1, Math.max(0, speedFrac * 9 - k)),
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <div className="ctt-gt-lcd">
              <div className="ctt-gt-spd">
                {v !== undefined ? Math.round(v) : '--'}
              </div>
              <div className="ctt-gt-unit">KM/H</div>
            </div>
            <div className="ctt-gt-row">
              <div className="ctt-gt-box">
                <b>{gear}</b>
                <span>GEAR</span>
              </div>
              <div className="ctt-gt-mode">
                {['ECO', 'COMFORT', 'SPORT+'].map((m, k) => (
                  <em key={m} className={k === mode ? 'on' : undefined}>
                    {m}
                  </em>
                ))}
              </div>
            </div>
            <div className="ctt-gt-bars">
              <span>DIST</span>
              <div className="ctt-gt-bar">
                <i style={{ width: pct(distFrac) }} />
              </div>
              <span className="ctt-gt-val">{dist} m</span>
              <span>MAX</span>
              <div className="ctt-gt-bar hot">
                <i style={{ width: pct(maxFrac) }} />
              </div>
              <span className="ctt-gt-val">{Math.round(stats.maxSpeed)}</span>
            </div>
          </section>

          <Dial
            className="ctt-gt-speedo"
            labels={speedLabels}
            frac={speedFrac}
            top="GT"
            bottom="km/h"
          />
        </div>
      </div>

      <div className="ctt-prof-ctl">
        <button
          className="ctt-btn"
          aria-label={playing ? 'Pause replay' : 'Replay clip'}
          onClick={() => setPlaying((x) => !x)}
        >
          <SvgIcon name={playing ? 'pause' : 'play'} size={14} />
        </button>
        <input
          type="range"
          min={0}
          max={last}
          value={idx ?? 0}
          aria-label="Scrub through the clip"
          onChange={(e) => {
            setPlaying(false);
            onProbe(Number(e.target.value));
          }}
        />
        <span className="ctt-prof-read">
          {((times[idx ?? 0] ?? 0) / 1000).toFixed(1)} /{' '}
          {(times[last] / 1000).toFixed(1)} s
        </span>
      </div>
    </div>
  );
}
