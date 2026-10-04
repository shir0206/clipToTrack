import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { Clip, GpsPoint } from './types';
import { Dial } from './SpeedCluster';
import SvgIcon from './SvgIcon';
import './SpeedCluster.css';
import './AltitudeCluster.css';

type Props = {
  clip: Clip;
  /** index into clip.samples, driven by the map path (hover / click / video playhead); null = nothing yet */
  probe: number | null;
};

const fin = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/**
 * Frame-by-frame easing toward `target` (exponential smoothing, `tau` seconds). Hover jumps and
 * 60 fps video playheads both end up as one smooth glide. It uses the rAF of the window the cluster
 * is drawn in, because the main window's rAF is throttled while a popup covers it.
 */
function useSmooth(
  target: number,
  tau: number,
  host: RefObject<HTMLElement | null>,
  eps = 1e-3,
) {
  const [value, setValue] = useState(target);
  const cur = useRef(target);
  const goal = useRef(target);
  const raf = useRef(0);
  const win = useRef<Window>(window);

  useEffect(() => {
    goal.current = target;
    if (raf.current) return; // the loop is already running and reads `goal`
    win.current = host.current?.ownerDocument.defaultView ?? window;
    const w = win.current;
    let last = w.performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const d = goal.current - cur.current;
      if (Math.abs(d) < eps) {
        cur.current = goal.current;
        setValue(cur.current);
        raf.current = 0;
        return;
      }
      cur.current += d * (1 - Math.exp(-dt / tau));
      setValue(cur.current);
      raf.current = w.requestAnimationFrame(step);
    };
    raf.current = w.requestAnimationFrame(step);
  }, [target, tau, eps, host]);

  useEffect(
    () => () => {
      if (raf.current) win.current.cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );
  return value;
}

/** Pre-computed series for every sample, so the per-frame work is just interpolation. */
type Track = {
  alt: number[];
  dist: number[];
  /** vertical speed, m/s */
  vs: number[];
  /** slope, % */
  grade: number[];
  /** cumulative ascent / descent, m (ignores wiggles under 1.5 m: GPS noise) */
  gain: number[];
  loss: number[];
  min: number;
  max: number;
  vsMax: number;
};

function buildTrack(samples: GpsPoint[]): Track | null {
  const n = samples.length;
  if (n < 2) return null;
  const first = samples.map((p) => p.altM).find(fin);
  if (first === undefined) return null;
  // gaps in altitude repeat the previous value
  const alt: number[] = [];
  let prev = first;
  for (const p of samples) {
    if (fin(p.altM)) prev = p.altM;
    alt.push(prev);
  }
  const dist = samples.map((p, i) =>
    fin(p.cumulativeDistM) ? p.cumulativeDistM : i,
  );
  const t = samples.map((p) => Date.parse(p.utc ?? ''));

  // slope and vertical speed over a short window, so GPS noise averages out
  const vs: number[] = [];
  const grade: number[] = [];
  for (let i = 0; i < n; i++) {
    let lo = i;
    let hi = i;
    while (
      (hi - lo < 2 || !((t[hi] - t[lo]) / 1000 >= 2)) &&
      hi - lo < 20 &&
      (lo > 0 || hi < n - 1)
    ) {
      if (lo > 0) lo--;
      if (hi < n - 1) hi++;
    }
    const dz = alt[hi] - alt[lo];
    const s = (t[hi] - t[lo]) / 1000;
    const d = dist[hi] - dist[lo];
    vs.push(s > 0.3 ? clamp(dz / s, -30, 30) : 0);
    grade.push(d >= 20 ? clamp((dz / d) * 100, -25, 25) : 0);
  }

  const gain = [0];
  const loss = [0];
  let ref = alt[0];
  let g = 0;
  let l = 0;
  for (let i = 1; i < n; i++) {
    const d = alt[i] - ref;
    if (d >= 1.5) {
      g += d;
      ref = alt[i];
    } else if (d <= -1.5) {
      l -= d;
      ref = alt[i];
    }
    gain.push(g);
    loss.push(l);
  }

  return {
    alt,
    dist,
    vs,
    grade,
    gain,
    loss,
    min: Math.min(...alt),
    max: Math.max(...alt),
    vsMax: Math.max(...vs.map(Math.abs)),
  };
}

/** value of `arr` at the fractional index `f` */
const at = (arr: number[], f: number) => {
  const i = Math.floor(f);
  const j = Math.min(i + 1, arr.length - 1);
  return arr[i] + (arr[j] - arr[i]) * (f - i);
};

// ───────── the altimeter: a real three-turn-style dial ─────────
// long hand = hundreds of metres (one full turn per 1000 m), short hand = thousands (one turn per
// 10 000 m). Both turn continuously, so crossing 1000 m never makes a hand jump.
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)] as const;
};

function AltDial({ alt }: { alt: number }) {
  const uid = useId().replace(/:/g, '');
  const turn = (((alt % 1000) + 1000) % 1000) / 1000;
  const f = clamp(turn, 0.0005, 0.9995);
  const [x0, y0] = polar(-90, 91);
  const [x1, y1] = polar(-90 + 360 * f, 91);

  const ticks = [];
  for (let i = 0; i < 50; i++) {
    const major = i % 5 === 0;
    const [ax, ay] = polar(-90 + i * 7.2, major ? 75 : 81);
    const [bx, by] = polar(-90 + i * 7.2, 86);
    ticks.push(
      <line
        key={i}
        className={major ? 'maj' : 'min'}
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
      />,
    );
  }

  return (
    <svg
      className="ctt-gt-dial ctt-al-dial"
      viewBox="0 0 200 200"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${uid}-face`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#1f1f22" />
          <stop offset="70%" stopColor="#121214" />
          <stop offset="100%" stopColor="#060607" />
        </radialGradient>
        <linearGradient id={`${uid}-bezel`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9a9a9f" />
          <stop offset="35%" stopColor="#2c2c2f" />
          <stop offset="65%" stopColor="#161618" />
          <stop offset="100%" stopColor="#66666b" />
        </linearGradient>
        <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${uid}-hub`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#f5f5f6" />
          <stop offset="45%" stopColor="#98989d" />
          <stop offset="100%" stopColor="#2d2d30" />
        </radialGradient>
      </defs>

      <circle
        className="ctt-gt-bezel"
        cx="100"
        cy="100"
        r="97.5"
        stroke={`url(#${uid}-bezel)`}
      />
      <circle
        className="ctt-gt-face"
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

      <circle className="ctt-gt-track" cx="100" cy="100" r="91" />
      <path
        className="ctt-gt-fill"
        d={`M${x0.toFixed(2)},${y0.toFixed(2)}A91,91 0 ${f > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`}
      />
      {ticks}
      {Array.from({ length: 10 }, (_, k) => {
        const [x, y] = polar(-90 + k * 36, 60);
        return (
          <text key={k} className="ctt-gt-lbl" x={x} y={y}>
            {k}
          </text>
        );
      })}

      <text className="ctt-gt-cap" x="100" y="130">
        ALT
      </text>
      <text className="ctt-gt-unit" x="100" y="142">
        x100 m
      </text>

      {/* thousands hand: short and broad, in the clip colour */}
      <g
        className="ctt-al-hand is-short"
        transform={`rotate(${-90 + alt * 0.036} 100 100)`}
      >
        <polygon points="100,94.5 132,97.5 146,100 132,102.5 100,105.5" />
      </g>
      {/* hundreds hand: long, with a counterweight */}
      <g
        className="ctt-al-hand"
        transform={`rotate(${-90 + alt * 0.36} 100 100)`}
      >
        <polygon points="70,97.6 86,97.6 100,98.6 161,99.5 161,100.5 100,101.4 86,102.4 70,102.4" />
      </g>
      <circle
        className="ctt-gt-hub"
        cx="100"
        cy="100"
        r="9"
        fill={`url(#${uid}-hub)`}
      />
      <circle className="ctt-gt-hub-dot" cx="100" cy="100" r="3" />
    </svg>
  );
}

const SW = 200; // profile strip viewBox
const SH = 36;
const SPAD = 4;
const VS_SCALES = [2, 4, 6, 10, 20, 40];
const signed = (n: number, d = 0) =>
  `${n < 0 ? '-' : n > 0 ? '+' : ''}${Math.abs(n).toFixed(d)}`;

/**
 * Altitude instrument cluster fed by the clip's own GPS samples, in the same style as the speedometer.
 *  - left dial: altimeter (two hands, like an aircraft instrument)
 *  - centre: the height as a big number, ascent / descent so far and the route's profile with a
 *    marker riding along it
 *  - right dial: climb rate (vertical speed) with slope and the clip's peak
 * The route on the map (hover, click, or the video playhead) is the controller. Everything is eased
 * frame by frame, so jumps glide instead of snapping.
 */
export default function AltitudeCluster({ clip, probe }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const clipId = useId().replace(/:/g, '');
  const samples = clip.samples;
  const last = samples.length - 1;
  const track = useMemo(() => buildTrack(samples), [samples]);

  // keep showing the last probed sample when the pointer leaves the route
  const [held, setHeld] = useState<number | null>(null);
  if (probe !== null && probe !== held) setHeld(probe);
  const idx = probe ?? held;

  // position along the route, eased: the number, hands and marker all derive from it
  const pos = useSmooth(idx ?? 0, 0.14, host, 0.01);
  const fc = clamp(pos, 0, Math.max(last, 0));
  const vsTarget = track ? at(track.vs, fc) : 0;
  const vsNow = useSmooth(vsTarget, 0.35, host);

  const profile = useMemo(() => {
    if (!track) return null;
    const span = track.max - track.min || 1;
    const total = track.dist[last] || 1;
    let line = '';
    track.alt.forEach((v, i) => {
      const x = (track.dist[i] / total) * SW;
      const y = SH - SPAD - ((v - track.min) / span) * (SH - 2 * SPAD);
      line += `${line ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      line,
      area: `${line}L${SW},${SH}L0,${SH}Z`,
      total,
      span,
      y: (v: number) => SH - SPAD - ((v - track.min) / span) * (SH - 2 * SPAD),
    };
  }, [track, last]);

  if (!track || !profile)
    return (
      <p className="ctt-hint" style={{ padding: 12 }}>
        No altitude data in this clip.
      </p>
    );

  const alt = at(track.alt, fc);
  const xFrac = clamp(at(track.dist, fc) / profile.total, 0, 1);
  const gainNow = at(track.gain, fc);
  const lossNow = at(track.loss, fc);
  const grade = at(track.grade, fc);
  const dec = profile.span < 10 ? 1 : 0;

  // 12 LED segments: where the current height sits between the clip's lowest and highest point
  const rel = clamp((alt - track.min) / profile.span, 0, 1);

  const vsScale =
    VS_SCALES.find((s) => s >= track.vsMax * 1.1) ??
    VS_SCALES[VS_SCALES.length - 1];
  const vsLabels = [-vsScale, -vsScale / 2, 0, vsScale / 2, vsScale].map(
    String,
  );
  const vsFrac = (clamp(vsNow, -vsScale, vsScale) / vsScale + 1) / 2;

  return (
    <div
      ref={host}
      className="ctt-gt ctt-al"
      role="img"
      aria-label={`Altimeter: ${Math.round(alt)} m, ${signed(vsNow, 1)} m/s`}
    >
      <AltDial alt={alt} />

      <section className="ctt-gt-mid">
        <div className="ctt-gt-seg" aria-hidden="true">
          {Array.from({ length: 12 }, (_, k) => (
            <i
              key={k}
              style={{ '--on': clamp(rel * 12 - k, 0, 1) } as CSSProperties}
            />
          ))}
        </div>
        <div className="ctt-gt-readout">
          <span className="ctt-gt-label">ALTITUDE</span>
          <div className="ctt-gt-read">
            <b>{alt.toFixed(dec)}</b>
            <span>m</span>
          </div>
        </div>
        <div className="ctt-gt-tiles">
          <div className="ctt-gt-tile">
            <span className="ctt-gt-ico">
              <SvgIcon name="arrowUp" size={20} />
            </span>
            <span className="ctt-gt-tx">
              <em>Ascent</em>
              <b>{Math.round(gainNow)} m</b>
            </span>
          </div>
          <div className="ctt-gt-tile">
            <span className="ctt-gt-ico">
              <SvgIcon name="arrowDown" size={20} />
            </span>
            <span className="ctt-gt-tx">
              <em>Descent</em>
              <b>{Math.round(lossNow)} m</b>
            </span>
          </div>
        </div>

        <div className="ctt-al-strip" aria-hidden="true">
          <svg viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="none">
            <defs>
              <clipPath id={`${clipId}-done`}>
                <rect x="0" y="0" width={xFrac * SW} height={SH} />
              </clipPath>
            </defs>
            <path className="ctt-al-area" d={profile.area} />
            {idx !== null && (
              <path
                className="ctt-al-done"
                d={profile.area}
                clipPath={`url(#${clipId}-done)`}
              />
            )}
            <path className="ctt-al-line" d={profile.line} />
          </svg>
          {idx !== null ? (
            <>
              <i
                className="ctt-al-cursor"
                style={{ left: `${xFrac * 100}%` }}
              />
              <i
                className="ctt-al-dot"
                style={{
                  left: `${xFrac * 100}%`,
                  top: `${(profile.y(alt) / SH) * 100}%`,
                }}
              />
            </>
          ) : (
            <span className="ctt-al-hint">
              Hover or play the route on the map
            </span>
          )}
        </div>
      </section>

      <Dial
        className="ctt-gt-tach"
        labels={vsLabels}
        frac={vsFrac}
        sub={5}
        title="CLIMB"
        unit="m/s"
        pills={[
          ['GRADE', `${signed(grade, 1)}%`],
          ['PEAK', `${Math.round(track.max)} m`],
        ]}
      />
    </div>
  );
}
