import {
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react';
import type { Clip } from './types';
import SvgIcon from './SvgIcon';
import SpeedCluster from './SpeedCluster';

type Props = {
  clip: Clip;
  probe: number | null;
  onProbe: (i: number | null) => void;
  onClose: () => void;
};

type Metric = 'alt' | 'speed';
type Tab = Metric | 'split';
type Side = 'left' | 'right';
type SpeedMode = 'graph' | 'dial';

const W = 1000;
const H = 100;
const PAD = 6;

const LABEL: Record<Metric, string> = { alt: 'Altitude', speed: 'Speed' };
const UNIT: Record<Metric, string> = { alt: 'm', speed: 'km/h' };
const otherOf = (m: Metric): Metric => (m === 'alt' ? 'speed' : 'alt');

/** One metric of the selected clip: a chart (or, for speed, optionally the speedometer). */
function Pane({
  clip,
  metric,
  probe,
  onProbe,
  speedMode,
  onSpeedMode,
}: {
  clip: Clip;
  metric: Metric;
  probe: number | null;
  onProbe: (i: number | null) => void;
  speedMode: SpeedMode;
  onSpeedMode: (m: SpeedMode) => void;
}) {
  const unit = UNIT[metric];
  const dial = metric === 'speed' && speedMode === 'dial';

  const chart = useMemo(() => {
    const vals = clip.samples.map((p) =>
      metric === 'alt' ? p.altM : p.speed3dKmh,
    );
    const xs = clip.samples.map((p, i) => p.cumulativeDistM ?? i);
    const ok = vals.filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    if (ok.length < 2) return null;
    const min = Math.min(...ok);
    const max = Math.max(...ok);
    const span = max - min || 1;
    const total = xs[xs.length - 1] || 1;
    const px = (i: number) => (xs[i] / total) * W;
    const py = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
    let line = '';
    vals.forEach((v, i) => {
      if (typeof v === 'number' && Number.isFinite(v))
        line += `${line ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`;
    });
    return {
      vals,
      xs,
      min,
      max,
      total,
      line,
      area: `${line}L${W},${H}L0,${H}Z`,
      py,
    };
  }, [clip, metric]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!chart) return;
    const r = e.currentTarget.getBoundingClientRect();
    const target =
      Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * chart.total;
    let best = 0;
    for (let i = 1; i < chart.xs.length; i++)
      if (Math.abs(chart.xs[i] - target) < Math.abs(chart.xs[best] - target))
        best = i;
    onProbe(best);
  };

  const pv = chart && probe !== null ? chart.vals[probe] : undefined;
  const showProbe = chart && probe !== null && typeof pv === 'number';

  return (
    <section className="ctt-prof-pane" aria-label={LABEL[metric]}>
      <div className="ctt-prof-pane-head">
        <b>{LABEL[metric]}</b>
        <span className="ctt-prof-read">
          {dial
            ? ''
            : chart && showProbe
              ? `${chart.xs[probe!].toFixed(0)} m · ${pv!.toFixed(1)} ${unit}`
              : chart
                ? `${chart.min.toFixed(0)}–${chart.max.toFixed(0)} ${unit}`
                : ''}
        </span>
        {metric === 'speed' && (
          <div className="ctt-prof-tabs" role="group" aria-label="Speed view">
            {(['graph', 'dial'] as const).map((m) => (
              <button
                key={m}
                className={`ctt-chip${speedMode === m ? ' is-on' : ''}`}
                aria-pressed={speedMode === m}
                onClick={() => onSpeedMode(m)}
              >
                {m === 'graph' ? 'Graph' : 'Speedometer'}
              </button>
            ))}
          </div>
        )}
      </div>

      {dial ? (
        <SpeedCluster
          key={clip.id}
          clip={clip}
          probe={probe}
          onProbe={onProbe}
        />
      ) : chart ? (
        <div
          className="ctt-prof-plot"
          onPointerMove={onMove}
          onPointerLeave={() => onProbe(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <path d={chart.area} fill="var(--c)" opacity="0.15" />
            <path
              d={chart.line}
              fill="none"
              stroke="var(--c)"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {showProbe && (
            <>
              <i
                className="ctt-prof-cross"
                style={{ left: `${(chart.xs[probe!] / chart.total) * 100}%` }}
              />
              <i
                className="ctt-prof-dot"
                style={{
                  left: `${(chart.xs[probe!] / chart.total) * 100}%`,
                  top: `${(chart.py(pv!) / H) * 100}%`,
                }}
              />
            </>
          )}
        </div>
      ) : (
        <p className="ctt-hint" style={{ padding: 12 }}>
          No {metric === 'alt' ? 'altitude' : 'speed'} data in this clip.
        </p>
      )}
    </section>
  );
}

/**
 * Altitude / speed dock of the selected clip. Hovering a chart moves a marker on the map.
 * - Drag a tab onto the other tab (or onto the left / right half of the dock) to open them side by side in a new tab.
 * - The side-by-side tab has an × to cancel it.
 * - Speed can be shown as a graph or as the GT speedometer.
 */
export default function ElevationProfile({
  clip,
  probe,
  onProbe,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('alt');
  const [single, setSingle] = useState<Metric>('alt'); // where "cancel" returns to
  const [split, setSplit] = useState<[Metric, Metric] | null>(null); // [left, right]
  const [speedMode, setSpeedMode] = useState<SpeedMode>('graph');

  const [drag, setDrag] = useState<Metric | null>(null);
  const [overTab, setOverTab] = useState<Metric | null>(null);
  const [overSide, setOverSide] = useState<Side | null>(null);

  const endDrag = () => {
    setDrag(null);
    setOverTab(null);
    setOverSide(null);
  };
  const pickSingle = (m: Metric) => {
    setSingle(m);
    setTab(m);
  };
  const makeSplit = (dragged: Metric, side: Side) => {
    const other = otherOf(dragged);
    setSplit(side === 'left' ? [dragged, other] : [other, dragged]);
    setTab('split');
  };
  const cancelSplit = () => {
    setSplit(null);
    setTab(single);
  };

  const metrics: Metric[] =
    tab === 'split' && split ? split : [tab === 'split' ? single : tab];

  const tabDrag = (k: Metric) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', k); // Firefox needs data to start a drag
      e.dataTransfer.effectAllowed = 'move';
      setDrag(k);
    },
    onDragEnd: endDrag,
    onDragOver: (e: DragEvent) => {
      if (drag && drag !== k) {
        e.preventDefault();
        setOverTab(k);
      }
    },
    onDragLeave: () => setOverTab(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (drag && drag !== k) makeSplit(drag, 'right'); // dragged tab joins the one it was dropped on
      endDrag();
    },
  });

  return (
    <div className="ctt-prof" style={{ '--c': clip.color } as CSSProperties}>
      <div className="ctt-prof-head">
        <SvgIcon name="chart" size={14} />
        <strong>{clip.title}</strong>

        <div className="ctt-prof-tabs">
          {(['alt', 'speed'] as const).map((k) => (
            <button
              key={k}
              className={`ctt-chip ctt-tab${tab === k ? ' is-on' : ''}${overTab === k ? ' is-drop' : ''}`}
              aria-pressed={tab === k}
              title="Drag onto the other tab to view them side by side"
              onClick={() => pickSingle(k)}
              {...tabDrag(k)}
            >
              {LABEL[k]}
            </button>
          ))}

          {split ? (
            <span
              className={`ctt-chip ctt-tab-split${tab === 'split' ? ' is-on' : ''}`}
            >
              <button
                className="ctt-tab-split-main"
                aria-pressed={tab === 'split'}
                onClick={() => setTab('split')}
              >
                {LABEL[split[0]]} | {LABEL[split[1]]}
              </button>
              <button
                className="ctt-tab-split-x"
                aria-label="Cancel side-by-side view"
                title="Cancel side-by-side view"
                onClick={cancelSplit}
              >
                <SvgIcon name="close" size={11} />
              </button>
            </span>
          ) : null}
        </div>

        <button
          className="ctt-btn"
          aria-label="Close profile"
          onClick={onClose}
        >
          <SvgIcon name="close" size={14} />
        </button>
      </div>

      <div className="ctt-prof-body">
        {metrics.map((m) => (
          <Pane
            key={m}
            clip={clip}
            metric={m}
            probe={probe}
            onProbe={onProbe}
            speedMode={speedMode}
            onSpeedMode={setSpeedMode}
          />
        ))}

        {drag && (
          <div className="ctt-prof-drop" aria-hidden="true">
            {(['left', 'right'] as const).map((side) => (
              <div
                key={side}
                className={`ctt-prof-drop-half${overSide === side ? ' is-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverSide(side);
                }}
                onDragLeave={() => setOverSide(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  makeSplit(drag, side);
                  endDrag();
                }}
              >
                <span>{LABEL[side === 'left' ? drag : otherOf(drag)]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
