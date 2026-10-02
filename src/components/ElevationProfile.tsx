import { useMemo, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Clip } from './types';
import SvgIcon from './SvgIcon';

type Props = {
  clip: Clip;
  probe: number | null;
  onProbe: (i: number | null) => void;
  onClose: () => void;
};

const W = 1000;
const H = 100;
const PAD = 6;

/** Altitude / speed chart of the selected clip. Hovering it moves a marker on the map. */
export default function ElevationProfile({ clip, probe, onProbe, onClose }: Props) {
  const [metric, setMetric] = useState<'alt' | 'speed'>('alt');
  const unit = metric === 'alt' ? 'm' : 'km/h';

  const chart = useMemo(() => {
    const vals = clip.samples.map((p) => (metric === 'alt' ? p.altM : p.speed3dKmh));
    const xs = clip.samples.map((p, i) => p.cumulativeDistM ?? i);
    const ok = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (ok.length < 2) return null;
    const min = Math.min(...ok);
    const max = Math.max(...ok);
    const span = max - min || 1;
    const total = xs[xs.length - 1] || 1;
    const px = (i: number) => (xs[i] / total) * W;
    const py = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
    let line = '';
    vals.forEach((v, i) => {
      if (typeof v === 'number' && Number.isFinite(v)) line += `${line ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`;
    });
    return { vals, xs, min, max, total, line, area: `${line}L${W},${H}L0,${H}Z`, py };
  }, [clip, metric]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!chart) return;
    const r = e.currentTarget.getBoundingClientRect();
    const target = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * chart.total;
    let best = 0;
    for (let i = 1; i < chart.xs.length; i++)
      if (Math.abs(chart.xs[i] - target) < Math.abs(chart.xs[best] - target)) best = i;
    onProbe(best);
  };

  const pv = chart && probe !== null ? chart.vals[probe] : undefined;
  const showProbe = chart && probe !== null && typeof pv === 'number';

  return (
    <div className="ctt-prof" style={{ '--c': clip.color } as CSSProperties}>
      <div className="ctt-prof-head">
        <SvgIcon name="chart" size={14} />
        <strong>{clip.title}</strong>
        <div className="ctt-prof-tabs">
          {(['alt', 'speed'] as const).map((k) => (
            <button key={k} className={`ctt-chip${metric === k ? ' is-on' : ''}`} onClick={() => setMetric(k)}>
              {k === 'alt' ? 'Altitude' : 'Speed'}
            </button>
          ))}
        </div>
        <span className="ctt-prof-read">
          {chart && showProbe
            ? `${(chart.xs[probe!]).toFixed(0)} m · ${pv!.toFixed(1)} ${unit}`
            : chart
              ? `${chart.min.toFixed(0)}–${chart.max.toFixed(0)} ${unit}`
              : ''}
        </span>
        <button className="ctt-btn" aria-label="Close profile" onClick={onClose}>
          <SvgIcon name="close" size={14} />
        </button>
      </div>
      {chart ? (
        <div className="ctt-prof-plot" onPointerMove={onMove} onPointerLeave={() => onProbe(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <path d={chart.area} fill="var(--c)" opacity="0.15" />
            <path d={chart.line} fill="none" stroke="var(--c)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
          {showProbe && (
            <>
              <i className="ctt-prof-cross" style={{ left: `${(chart.xs[probe!] / chart.total) * 100}%` }} />
              <i className="ctt-prof-dot" style={{ left: `${(chart.xs[probe!] / chart.total) * 100}%`, top: `${(chart.py(pv!) / H) * 100}%` }} />
            </>
          )}
        </div>
      ) : (
        <p className="ctt-hint" style={{ padding: 12 }}>No {metric === 'alt' ? 'altitude' : 'speed'} data in this clip.</p>
      )}
    </div>
  );
}
