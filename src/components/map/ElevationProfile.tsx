import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Clip } from '../../types';
import SvgIcon, { type IconName } from '../common/SvgIcon';
import SpeedCluster from '../instruments/SpeedCluster/SpeedCluster';
import AltitudeCluster from '../instruments/AltitudeCluster/AltitudeCluster';

type Props = {
  clip: Clip;
  probe: number | null;
  onProbe: (i: number | null) => void;
  onClose: () => void;
};

type Metric = 'alt' | 'speed';
type Tab = Metric | 'split';
type Side = 'left' | 'right';
type ViewMode = 'graph' | 'dial';

const W = 1000;
const H = 100;
const PAD = 6;

const HEIGHT_KEY = 'clip-to-track:profile-height';
const DEFAULT_H = 260;
const MIN_H = 170;
const MIN_STAGE = 200; // the map always keeps at least this much

const LABEL: Record<Metric, string> = { alt: 'Altitude', speed: 'Speed' };
const UNIT: Record<Metric, string> = { alt: 'm', speed: 'km/h' };
const ICON: Record<Metric, IconName> = { alt: 'mountain', speed: 'gauge' };
/** label of the instrument-cluster view of each metric */
const DIAL_LABEL: Record<Metric, string> = {
  alt: 'Altimeter',
  speed: 'Speedometer',
};
const otherOf = (m: Metric): Metric => (m === 'alt' ? 'speed' : 'alt');

/** One metric of the selected clip: a chart or its instrument cluster (altimeter / speedometer). */
function Pane({
  clip,
  metric,
  probe,
  onProbe,
  mode,
  onPop,
}: {
  clip: Clip;
  metric: Metric;
  probe: number | null;
  onProbe: (i: number | null) => void;
  mode: ViewMode;
  /** open this metric in its own window (absent inside the popup itself) */
  onPop?: () => void;
}) {
  const unit = UNIT[metric];
  const dial = mode === 'dial';

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

  const popBtn = onPop && (
    <button
      className="ctt-btn ctt-pane-pop"
      aria-label={`Open ${LABEL[metric]} in a new window`}
      title="Open in a new window"
      onClick={onPop}
    >
      <SvgIcon name="external" size={13} />
    </button>
  );

  const pv = chart && probe !== null ? chart.vals[probe] : undefined;
  const showProbe = chart && probe !== null && typeof pv === 'number';

  return (
    <section
      className={`ctt-prof-pane${dial ? ' is-dial' : ''}`}
      aria-label={LABEL[metric]}
    >
      {dial && popBtn}
      {!dial && (
        <div className="ctt-prof-pane-head">
          <b>{LABEL[metric]}</b>
          <span className="ctt-prof-read">
            {chart && showProbe
              ? `${chart.xs[probe!].toFixed(0)} m · ${pv!.toFixed(1)} ${unit}`
              : chart
                ? `${chart.min.toFixed(0)}-${chart.max.toFixed(0)} ${unit}`
                : ''}
          </span>
          {popBtn}
        </div>
      )}

      {dial ? (
        metric === 'alt' ? (
          <AltitudeCluster key={clip.id} clip={clip} probe={probe} />
        ) : (
          <SpeedCluster key={clip.id} clip={clip} probe={probe} />
        )
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
        <p className="ctt-hint ctt-hint-pad">
          No {metric === 'alt' ? 'altitude' : 'speed'} data in this clip.
        </p>
      )}
    </section>
  );
}

const PLOT_ROOT = 'ctt-plot-root';

/**
 * Opens an empty popup (no toolbar / address bar) that looks like the app: the page's stylesheets are
 * copied in. Must be called synchronously from a click handler, otherwise the popup blocker refuses it.
 */
function openPlotWindow(title: string): Window | null {
  const w = Math.min(900, window.screen.availWidth - 80);
  const h = Math.min(380, window.screen.availHeight - 80);
  const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
  const win = window.open(
    '',
    '_blank',
    `popup=yes,resizable=yes,width=${w},height=${h},left=${left},top=${top}`,
  );
  if (!win) return null;

  const doc = win.document;
  doc.title = title;
  doc.head.innerHTML =
    '<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />';
  document
    .querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
      'link[rel="stylesheet"], style',
    )
    .forEach((n) => {
      if (n instanceof HTMLLinkElement) {
        const l = doc.createElement('link');
        l.rel = 'stylesheet';
        l.href = n.href; // absolute, so it resolves inside the popup
        doc.head.appendChild(l);
      } else doc.head.appendChild(doc.importNode(n, true));
    });
  doc.body.style.margin = '0';
  doc.body.innerHTML = `<div id="${PLOT_ROOT}"></div>`;
  return win;
}

function setPlotWindowTitle(win: Window, title: string) {
  win.document.title = title;
}

/** One metric (chart or instrument cluster) of the selected clip in its own window. Hovering it drives the map too. */
function PlotWindow({
  win,
  clip,
  metric,
  probe,
  onProbe,
  mode,
  onClose,
}: {
  win: Window;
  clip: Clip;
  metric: Metric;
  probe: number | null;
  onProbe: (i: number | null) => void;
  mode: ViewMode;
  onClose: () => void;
}) {
  const [root] = useState(() => win.document.getElementById(PLOT_ROOT));
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setPlotWindowTitle(win, `${LABEL[metric]} · ${clip.title}`);
  }, [win, metric, clip.title]);

  useEffect(() => {
    let notified = false;
    const notify = () => {
      if (notified) return;
      notified = true;
      onCloseRef.current();
    };
    const onKey = (e: globalThis.KeyboardEvent) =>
      e.key === 'Escape' && win.close();
    win.addEventListener('pagehide', notify); // user closed the window
    win.addEventListener('keydown', onKey);
    const poll = window.setInterval(() => win.closed && notify(), 500);
    const closeWithParent = () => win.close(); // reloading the app takes its popups with it
    window.addEventListener('pagehide', closeWithParent);
    return () => {
      notified = true; // unmount must not report a user close
      window.clearInterval(poll);
      window.removeEventListener('pagehide', closeWithParent);
      win.removeEventListener('pagehide', notify);
      win.removeEventListener('keydown', onKey);
      // the dock closes its popups itself; closing here would break StrictMode re-runs
    };
  }, [win]);

  if (!root) return null;
  return createPortal(
    <div className="ctt-app ctt-pop">
      <div className="ctt-prof" style={{ '--c': clip.color } as CSSProperties}>
        <div className="ctt-prof-body">
          <Pane
            clip={clip}
            metric={metric}
            probe={probe}
            onProbe={onProbe}
            mode={mode}
          />
        </div>
      </div>
    </div>,
    root,
  );
}

/**
 * Altitude / speed dock of the selected clip. Hovering a chart moves a marker on the map.
 * - Drag a tab onto the other tab (or onto the left / right half of the dock) to open them side by side in a new tab.
 * - The side-by-side tab has an × to cancel it.
 * - Altitude and speed can each be shown as a graph or as an instrument cluster (altimeter / GT speedometer).
 * - Each metric has a button to open it in its own window (no toolbar); both can be open at once.
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
  const [modes, setModes] = useState<Record<Metric, ViewMode>>({
    alt: 'graph',
    speed: 'graph',
  });

  // pop-out windows, one per metric
  const [wins, setWins] = useState<Partial<Record<Metric, Window>>>({});
  const winsRef = useRef(wins);
  useEffect(() => {
    winsRef.current = wins;
  });
  useEffect(
    () => () =>
      Object.values(winsRef.current).forEach(
        (w) => w && !w.closed && w.close(),
      ),
    [],
  ); // closing the dock closes its windows
  const pop = (m: Metric) => {
    const old = wins[m];
    if (old && !old.closed) {
      old.focus();
      return;
    }
    const w = openPlotWindow(`${LABEL[m]} · ${clip.title}`); // synchronous: inside the click
    if (!w) {
      window.alert(
        'Your browser blocked the pop-up window. Allow pop-ups for this site and try again.',
      );
      return;
    }
    setWins((s) => ({ ...s, [m]: w }));
  };
  const popClosed = (m: Metric) =>
    setWins((s) => {
      const n = { ...s };
      delete n[m];
      return n;
    });

  // dock height: drag the grip on its top edge (or use ↑ / ↓); remembered between visits
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(
    () => Number(localStorage.getItem(HEIGHT_KEY)) || DEFAULT_H,
  );
  useEffect(() => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(height));
    } catch {
      /* ignore */
    }
  }, [height]);
  const clampH = (h: number) => {
    const room =
      root.current?.parentElement?.clientHeight ?? window.innerHeight;
    return Math.round(
      Math.min(Math.max(h, MIN_H), Math.max(MIN_H, room - MIN_STAGE)),
    );
  };
  const onGripMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const parent = root.current?.parentElement;
    if (parent)
      setHeight(clampH(parent.getBoundingClientRect().bottom - e.clientY));
  };
  const onGripKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') setHeight((h) => clampH(h + 24));
    else if (e.key === 'ArrowDown') setHeight((h) => clampH(h - 24));
    else return;
    e.preventDefault();
  };

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
    <div
      ref={root}
      className="ctt-prof"
      style={{ '--c': clip.color, '--h': `${height}px` } as CSSProperties}
    >
      <div
        className="ctt-prof-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize profile"
        aria-valuenow={height}
        aria-valuemin={MIN_H}
        tabIndex={0}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={onGripMove}
        onKeyDown={onGripKey}
        onDoubleClick={() => setHeight(clampH(DEFAULT_H))}
      />
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
              <SvgIcon name={ICON[k]} size={13} />
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
                <SvgIcon name="columns" size={13} />
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

        {metrics.map((m) => (
          <div
            key={m}
            className="ctt-prof-tabs ctt-prof-view"
            role="group"
            aria-label={`${LABEL[m]} view`}
          >
            {metrics.length > 1 && <SvgIcon name={ICON[m]} size={13} />}
            {(['graph', 'dial'] as const).map((v) => (
              <button
                key={v}
                className={`ctt-chip${modes[m] === v ? ' is-on' : ''}`}
                aria-pressed={modes[m] === v}
                onClick={() => setModes((s) => ({ ...s, [m]: v }))}
              >
                <SvgIcon name={v === 'graph' ? 'chart' : 'dial'} size={13} />
                {v === 'graph' ? 'Graph' : DIAL_LABEL[m]}
              </button>
            ))}
          </div>
        ))}

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
            mode={modes[m]}
            onPop={() => pop(m)}
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

      {(['alt', 'speed'] as const).map((m) => {
        const win = wins[m];
        return win ? (
          <PlotWindow
            key={m}
            win={win}
            clip={clip}
            metric={m}
            probe={probe}
            onProbe={onProbe}
            mode={modes[m]}
            onClose={() => popClosed(m)}
          />
        ) : null;
      })}
    </div>
  );
}
