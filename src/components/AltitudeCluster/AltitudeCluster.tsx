import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Clip, GpsPoint } from '../../types';
import { Dial } from '../SpeedCluster/SpeedCluster';
import Icon from '../Icon/Icon';
import './AltitudeCluster.css';

type Props = {
  clip: Clip;
  /** index into clip.samples, driven by the map path (hover / click / video playhead); null = nothing yet */
  probe: number | null;
  /** Optional measured weather. When absent, pressure and temperature are standard-atmosphere (ISA) values. */
  weather?: { pressureHpa?: number; tempC?: number };
  playback?: {
    playing: boolean;
    onTogglePlay: () => void;
    onStop: () => void;
  };
};

const fin = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/* ---------- number formatting ---------- */

/** signed number with a real minus sign; never prints "−0" */
const sign = (v: number, d: number) => {
  const r = Number(v.toFixed(d));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}`;
};
const trim = (n: number) => String(+n.toFixed(2));

/** standard atmosphere: pressure (hPa) and temperature (°C) at altitude h (m) */
const isaPressure = (h: number) =>
  1013.25 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
const isaTemp = (h: number) => 15 - 0.0065 * h;

/* ---------- scales ---------- */

/** climb-rate dial: smallest "nice" full-scale (m/min) with headroom over the clip's steepest climb / drop */
const RATE_SCALES = [
  1, 2, 5, 10, 15, 20, 30, 50, 100, 150, 200, 300, 500, 1000,
];
/** elevation dial has 6 intervals; smallest "nice" step (m) that fits the highest point */
const ALT_INTERVALS = 6;
const ALT_STEPS = [50, 100, 200, 250, 500, 1000, 2000];

/** 1-2-5 step for chart gridlines */
function niceStep(span: number, target: number) {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / mag;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
}

/* ---------- series derived from the clip's GPS samples ---------- */

type Series = {
  /** seconds since the first sample */
  t: number[];
  /** altitude (m) per sample */
  alt: number[];
  /** climb rate (m/min) per sample, measured over a short window so GPS noise averages out */
  rate: number[];
  dur: number;
  lo: number;
  hi: number;
  rateScale: number;
  altStep: number;
  /** decimals for altitude deltas: 1 for small relief, 0 for big climbs */
  decimals: number;
  /** trend chip window in seconds (0 = since the start of the clip) and its caption */
  trendWin: number;
  trendLabel: string;
};

function buildSeries(samples: GpsPoint[]): Series | null {
  const n = samples.length;
  const raw = samples.map((p) => p.altM);
  const first = raw.findIndex(fin);
  if (first < 0 || raw.filter(fin).length < 2) return null;

  // fill gaps with the previous valid altitude
  const alt: number[] = [];
  let prev = raw[first] as number;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (fin(v)) prev = v;
    alt.push(prev);
  }

  // time axis: GPS UTC stamps, falling back to the 10 Hz GoPro sample rate
  const ms = samples.map((p) => Date.parse(p.utc ?? ''));
  const hasUtc = ms.every(Number.isFinite) && ms[n - 1] > ms[0];
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = hasUtc ? (ms[i] - ms[0]) / 1000 : i * 0.1;
    t.push(i ? Math.max(v, t[i - 1]) : 0);
  }
  const dur = t[n - 1] || (n - 1) * 0.1;

  // climb rate over a centred window (two pointers; t is non-decreasing)
  const win = clamp(dur / 10, 1.2, 300);
  const rate: number[] = new Array(n).fill(0);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    while (t[lo] < t[i] - win / 2) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < n && t[hi + 1] <= t[i] + win / 2) hi++;
    rate[i] = t[hi] > t[lo] ? ((alt[hi] - alt[lo]) / (t[hi] - t[lo])) * 60 : 0;
  }

  const minA = Math.min(...alt);
  const maxA = Math.max(...alt);
  const maxRate = Math.max(...rate.map(Math.abs));
  const rateScale =
    RATE_SCALES.find((s) => s >= maxRate * 1.1) ??
    Math.ceil((maxRate * 1.1) / 1000) * 1000;
  const altStep =
    ALT_STEPS.find((s) => s * ALT_INTERVALS >= Math.max(maxA, 0) * 1.05) ??
    Math.ceil(maxA / ALT_INTERVALS / 1000) * 1000;

  const trendWin = dur >= 7200 ? 3600 : dur >= 180 ? 60 : 0;
  return {
    t,
    alt,
    rate,
    dur,
    lo: minA,
    hi: maxA,
    rateScale,
    altStep,
    decimals: maxA - minA < 20 ? 1 : 0,
    trendWin,
    trendLabel: trendWin === 3600 ? '(1 H)' : trendWin ? '(1 MIN)' : '',
  };
}

/** largest sample index whose time is <= x */
function indexAt(t: number[], x: number) {
  let lo = 0;
  let hi = t.length - 1;
  if (x <= t[0]) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

const fmtTime = (s: number, dur: number) => {
  if (dur <= 90) return `${+s.toFixed(1)} s`;
  if (dur < 7200)
    return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return `${+(s / 3600).toFixed(1)} h`;
};

/* ---------- big rolling number ---------- */

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
function RollingNumber({
  value,
  width,
  idle,
}: {
  value: number;
  width: number;
  idle: boolean;
}) {
  const s = String(Math.max(0, Math.round(value)))
    .padStart(width, '0')
    .slice(-width);
  let lead = true;
  return (
    <div className={`digit-row${idle ? ' is-idle' : ''}`} aria-hidden="true">
      {[...s].map((ch, i) => {
        const d = +ch;
        const hide = lead && d === 0 && i < width - 3;
        if (d !== 0) lead = false;
        return (
          <span key={i} className={`digit-column${hide ? ' is-hidden' : ''}`}>
            <span
              className="digit-strip"
              style={{ '--digit': d } as CSSProperties}
            >
              {DIGITS.map((k) => (
                <span key={k}>{k}</span>
              ))}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ---------- altitude profile ---------- */

const PL = 4;
const PR = 44;
const PT = 10;
const PB = 22;

function Profile({ s, i }: { s: Series; i: number | null }) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setBox({
        w: Math.round(e.contentRect.width),
        h: Math.round(e.contentRect.height),
      }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: W, h: H } = box;
  const g = useMemo(() => {
    if (W < 60 || H < 40) return null;
    const span = Math.max(s.hi - s.lo, 3);
    const mid = (s.hi + s.lo) / 2;
    const lo = mid - span * 0.62;
    const hi = mid + span * 0.62;
    const step = niceStep(hi - lo, 4);
    const y0 = Math.floor(lo / step) * step;
    const y1 = Math.ceil(hi / step) * step;
    const X = (t: number) => PL + ((W - PL - PR) * t) / s.dur;
    const Y = (a: number) => PT + (H - PT - PB) * (1 - (a - y0) / (y1 - y0));

    const yTicks: { y: number; label: string }[] = [];
    const nY = Math.round((y1 - y0) / step);
    for (let k = 0; k <= nY; k++) {
      const v = y0 + k * step;
      yTicks.push({
        y: Y(v),
        label: step < 1 ? v.toFixed(1) : String(Math.round(v)),
      });
    }
    const xStep = niceStep(s.dur, W < 360 ? 3 : 6);
    const xTicks: { x: number; label: string }[] = [];
    for (let k = 0; k * xStep <= s.dur + 1e-6; k++)
      xTicks.push({ x: X(k * xStep), label: fmtTime(k * xStep, s.dur) });

    // decimate long clips so the path stays light
    const stride = Math.max(1, Math.floor(s.t.length / (2 * (W - PL - PR))));
    const pts: string[] = [];
    for (let k = 0; k < s.t.length; k += stride)
      pts.push(`${X(s.t[k]).toFixed(1)},${Y(s.alt[k]).toFixed(1)}`);
    if ((s.t.length - 1) % stride)
      pts.push(
        `${X(s.t[s.t.length - 1]).toFixed(1)},${Y(s.alt[s.alt.length - 1]).toFixed(1)}`,
      );
    const line = `M${pts.join('L')}`;
    const base = H - PB;
    const area = `${line}L${X(s.dur).toFixed(1)},${base}L${X(0).toFixed(1)},${base}Z`;
    return { X, Y, yTicks, xTicks, line, area, startY: Y(s.alt[0]), base };
  }, [s, W, H]);

  const cx = g && i !== null ? g.X(s.t[i]) : 0;
  const cy = g && i !== null ? g.Y(s.alt[i]) : 0;

  return (
    <div className="altitude-graph" aria-hidden="true">
      <div className="graph-plot" ref={ref}>
        {g && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            <defs>
              <linearGradient id={`${uid}-ar`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0"
                  style={{ stopColor: 'var(--alt-climb)' }}
                  stopOpacity="0.42"
                />
                <stop
                  offset="1"
                  style={{ stopColor: 'var(--alt-climb)' }}
                  stopOpacity="0"
                />
              </linearGradient>
              <clipPath id={`${uid}-cp`}>
                <rect x="0" y="0" width={Math.max(0, cx)} height={H} />
              </clipPath>
            </defs>
            {g.yTicks.map((t, k) => (
              <g key={`y${k}`}>
                <line
                  className="graph-grid"
                  x1={PL}
                  x2={W - PR}
                  y1={t.y}
                  y2={t.y}
                />
                <text className="graph-tick" x={W - PR + 8} y={t.y + 4}>
                  {t.label}
                </text>
              </g>
            ))}
            {g.xTicks.map((t, k) => (
              <g key={`x${k}`}>
                <line
                  className="graph-grid"
                  x1={t.x}
                  x2={t.x}
                  y1={PT}
                  y2={g.base}
                />
                <text
                  className="graph-tick"
                  x={t.x}
                  y={H - 6}
                  textAnchor={k === 0 ? 'start' : 'middle'}
                >
                  {t.label}
                </text>
              </g>
            ))}
            <line
              className="graph-start"
              x1={PL}
              x2={W - PR}
              y1={g.startY}
              y2={g.startY}
            />
            <path className="graph-ghost" d={g.line} />
            <g clipPath={`url(#${uid}-cp)`}>
              <path d={g.area} fill={`url(#${uid}-ar)`} />
              <path className="graph-line" d={g.line} />
            </g>
            {i !== null && (
              <>
                <circle className="graph-pulse" r="5" cx={cx} cy={cy} />
                <circle className="graph-dot" r="5" cx={cx} cy={cy} />
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

/* ---------- tiles ---------- */

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const ICON_GAIN = icon(
  <>
    <path d="M3 20l6-9 4 5 3-4 5 8z" />
    <path d="M12 3v5M9.5 5.5L12 3l2.5 2.5" />
  </>,
);
const ICON_PRESSURE = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 12l4-4" />
    <path d="M7 15h2M15 15h2M12 6v1" />
  </>,
);
const ICON_TEMP = icon(<path d="M14 14.8V5a2 2 0 10-4 0v9.8a4 4 0 104 0z" />);

function Tile({
  ico,
  label,
  value,
  unit,
}: {
  ico: ReactNode;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="gauge-tile">
      <span className="tile-icon">{ico}</span>
      <span className="tile-text">
        <em>{label}</em>
        <b>
          {value}
          {unit && <small> {unit}</small>}
        </b>
      </span>
    </div>
  );
}

/**
 * Dark instrument cluster fed by the clip's own GPS altitude samples.
 *  - left dial: climb rate (m/min), centre-zero, green up / orange down
 *  - centre: rolling altitude readout, climb / drop trend, altitude profile, gain + air pressure + air temperature
 *  - right dial: elevation above sea level
 * Pressure and temperature are standard-atmosphere (ISA) values computed from the altitude unless
 * measured `weather` is passed. Like SpeedCluster it has no controls of its own: it shows the sample
 * picked by `probe`, so the route on the map (hover, click, or the video playhead) is the controller.
 */
export default function AltitudeCluster({
  clip,
  probe,
  weather,
  playback,
}: Props) {
  const samples = clip.samples;
  const S = useMemo(() => buildSeries(samples), [samples]);

  // keep showing the last probed sample when the pointer leaves the route
  const [held, setHeld] = useState<number | null>(null);
  if (probe !== null && probe !== held) setHeld(probe);
  const idx = probe ?? held;

  if (!S)
    return (
      <p className="video-hint is-padded">No altitude data in this clip.</p>
    );

  const i = idx !== null ? Math.min(idx, S.alt.length - 1) : null;
  const alt = i !== null ? S.alt[i] : undefined;
  const rate = i !== null ? S.rate[i] : 0;
  const d = S.decimals;

  const gain = alt !== undefined ? alt - S.alt[0] : 0;
  let delta = gain;
  if (i !== null && S.trendWin)
    delta = S.alt[i] - S.alt[indexAt(S.t, Math.max(0, S.t[i] - S.trendWin))];
  const down = delta < -0.005;

  const rateFrac = 0.5 + rate / (2 * S.rateScale);
  const altFrac =
    alt !== undefined ? Math.max(0, alt) / (S.altStep * ALT_INTERVALS) : 0;
  const segFrac =
    alt !== undefined && S.hi > S.lo ? (alt - S.lo) / (S.hi - S.lo) : 0;
  const progress = i !== null ? S.t[i] / S.dur : 0;

  const half = S.rateScale / 2;
  const rateLabels = [
    `−${trim(S.rateScale)}`,
    `−${trim(half)}`,
    '0',
    `+${trim(half)}`,
    `+${trim(S.rateScale)}`,
  ];
  const altLabels = Array.from({ length: ALT_INTERVALS + 1 }, (_, k) =>
    trim((k * S.altStep) / 1000),
  );
  const width = Math.max(String(Math.round(S.hi)).length, 3);

  const measured =
    !!weather && (fin(weather.pressureHpa) || fin(weather.tempC));
  const pressure = fin(weather?.pressureHpa)
    ? weather!.pressureHpa
    : alt !== undefined
      ? isaPressure(alt)
      : undefined;
  const temp = fin(weather?.tempC)
    ? weather!.tempC
    : alt !== undefined
      ? isaTemp(alt)
      : undefined;
  const src = measured ? '' : ' · ISA';

  return (
    <div
      className="gauge-cluster altitude-cluster"
      role="img"
      aria-label={
        alt !== undefined
          ? `Altitude ${Math.round(alt)} meters above sea level`
          : 'Altitude cluster'
      }
    >
      {playback && (
        <div className="gauge-playback-controls" aria-label="Altitude playback">
          <button
            className="gauge-playback-button"
            aria-label={`${playback.playing ? 'Pause' : 'Play'} ${clip.title} altitude`}
            onClick={playback.onTogglePlay}
            disabled={!clip.videoUrl}
          >
            <Icon name={playback.playing ? 'pause' : 'play'} size={15} />
          </button>
          <button
            className="gauge-playback-button"
            aria-label={`Stop ${clip.title} altitude`}
            onClick={playback.onStop}
            disabled={!clip.videoUrl}
          >
            <Icon name="stop" size={15} />
          </button>
        </div>
      )}

      <Dial
        className="altitude-dial"
        labels={rateLabels}
        frac={rateFrac}
        from={0.5}
        tone={rateFrac < 0.5 ? 'down' : 'up'}
        sub={5}
        title="CLIMB RATE"
        unit="m / min"
        pills={[['VERTICAL', i !== null ? sign(rate, 1) : '--']]}
      />

      <section className="altitude-middle">
        <div className="gauge-segment" aria-hidden="true">
          {Array.from({ length: 12 }, (_, k) => (
            <i
              key={k}
              style={{ '--on': clamp(segFrac * 12 - k, 0, 1) } as CSSProperties}
            />
          ))}
        </div>

        <div className="gauge-readout">
          <span className="gauge-label">Altitude</span>
          <div className="altitude-value">
            <RollingNumber
              value={alt ?? 0}
              width={width}
              idle={alt === undefined}
            />
            <span className="altitude-unit">m</span>
          </div>
          <div className={`trend-indicator${down ? ' is-down' : ''}`}>
            {i !== null ? (
              <>
                <span className="trend-arrow" />
                <span className="trend-value">{sign(delta, d)} m</span>
                <span className="trend-window">{S.trendLabel}</span>
              </>
            ) : null}
          </div>
          <span className="altitude-label">Meters above sea level</span>
        </div>

        <Profile s={S} i={i} />

        <div className="gauge-tiles">
          <Tile
            ico={ICON_GAIN}
            label="Alt. change"
            value={i !== null ? sign(gain, d) : '--'}
            unit={i !== null ? 'm' : undefined}
          />
          <Tile
            ico={ICON_PRESSURE}
            label={`${measured ? 'Pressure' : 'Air pressure'}${src}`}
            value={pressure !== undefined ? String(Math.round(pressure)) : '--'}
            unit={pressure !== undefined ? 'hPa' : undefined}
          />
          <Tile
            ico={ICON_TEMP}
            label={`${measured ? 'Temperature' : 'Air temp'}${src}`}
            value={temp !== undefined ? temp.toFixed(1) : '--'}
            unit={temp !== undefined ? '°C' : undefined}
          />
        </div>

        {i === null ? (
          <p className="gauge-hint">Hover or play the route on the map</p>
        ) : (
          <div className="gauge-bar" aria-hidden="true">
            <i
              style={
                {
                  '--progress': `${Math.round(progress * 100)}%`,
                } as CSSProperties
              }
            />
          </div>
        )}
      </section>

      <Dial
        className="altitude-dial"
        labels={altLabels}
        frac={altFrac}
        sub={5}
        title="ELEVATION"
        unit="km"
        pills={[
          ['SEA LEVEL', alt !== undefined ? `${Math.round(alt)} m` : '--'],
        ]}
      />
    </div>
  );
}
