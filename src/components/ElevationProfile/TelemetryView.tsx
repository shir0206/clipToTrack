import { useMemo, type CSSProperties, type PointerEvent } from 'react';
import type { Clip, GpsPoint } from '../../types';
import Icon from '../Icon/Icon';
import SpeedCluster from '../SpeedCluster/SpeedCluster';
import AltitudeCluster from '../AltitudeCluster/AltitudeCluster';
import {
  metricValue,
  type Metric,
  type ViewMode,
} from '../../lib/mapCapture/telemetryConfig';
const W = 1000;
const H = 100;
const PAD = 6;
const LABEL = { alt: 'Altitude', speed: 'Speed' };
const UNIT = { alt: 'm', speed: 'km/h' };
const fin = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function TelemetryDigits({
  value,
  ariaLabel,
}: {
  value: string;
  ariaLabel: string;
}) {
  if (value === '—')
    return (
      <span className="telemetry-readout-number" aria-label={ariaLabel}>
        —
      </span>
    );

  return (
    <span className="telemetry-readout-number" aria-label={ariaLabel}>
      {[...value].map((ch, i) => {
        const digit = Number(ch);
        return Number.isInteger(digit) ? (
          <span className="telemetry-digit-column" aria-hidden="true" key={i}>
            <span
              className="telemetry-digit-strip"
              style={{ '--digit': digit } as CSSProperties}
            >
              {DIGITS.map((k) => (
                <span key={k}>{k}</span>
              ))}
            </span>
          </span>
        ) : (
          <span aria-hidden="true" key={i}>
            {ch}
          </span>
        );
      })}
    </span>
  );
}

export function TelemetryReadout({
  clip,
  probe,
  sample: interpolated,
}: {
  clip: Clip;
  probe: number | null;
  sample?: GpsPoint;
}) {
  const sample = interpolated ?? clip.samples[probe ?? 0];
  const altitude = fin(sample?.altM) ? Math.round(sample.altM) : null;
  const speed = metricValue(sample, 'speed');
  const roundedSpeed = speed === undefined ? null : Math.round(speed);
  const altitudeText = altitude === null ? '—' : String(altitude);
  const speedText = roundedSpeed === null ? '—' : String(roundedSpeed);
  const progress =
    clip.samples.length > 1 && probe !== null
      ? Math.round((probe / (clip.samples.length - 1)) * 100)
      : 0;
  const aria =
    altitude === null && roundedSpeed === null
      ? 'No altitude or speed sample selected'
      : `Altitude ${altitudeText} meters, speed ${speedText} kilometers per hour`;

  return (
    <div className="telemetry-readout" role="group" aria-label={aria}>
      <div className="telemetry-readout-cell">
        <small>Altitude</small>
        <div className="telemetry-readout-value">
          <TelemetryDigits value={altitudeText} ariaLabel={altitudeText} />
          <span className="telemetry-readout-unit">m</span>
        </div>
      </div>
      <div className="telemetry-readout-cell">
        <small>Speed</small>
        <div className="telemetry-readout-value">
          <TelemetryDigits value={speedText} ariaLabel={speedText} />
          <span className="telemetry-readout-unit">km/h</span>
        </div>
      </div>
      <div className="gauge-bar" aria-hidden="true">
        <i style={{ '--progress': `${progress}%` } as CSSProperties} />
      </div>
    </div>
  );
}

/** One metric of the selected clip: a chart or its instrument cluster (altimeter / speedometer). */
export default function TelemetryView({
  clip,
  metric,
  probe,
  onProbe,
  mode,
  onPop,
  compact = false,
  playback,
  sample,
}: {
  clip: Clip;
  metric: Metric;
  compact?: boolean;
  probe: number | null;
  onProbe: (i: number | null) => void;
  mode: ViewMode;
  /** open this metric in its own window (absent inside the popup itself) */
  onPop?: () => void;
  playback?: { playing: boolean; onTogglePlay: () => void; onStop: () => void };
  sample?: GpsPoint;
}) {
  const unit = UNIT[metric];
  const dial = mode === 'dial';

  const chart = useMemo(() => {
    const vals = clip.samples.map((p) => metricValue(p, metric));
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
      className="icon-button pane-popover"
      aria-label={`Open ${LABEL[metric]} in a new window`}
      title="Open in a new window"
      onClick={onPop}
    >
      <Icon name="external" size={13} />
    </button>
  );

  const pv = sample
    ? metricValue(sample, metric)
    : chart && probe !== null
      ? chart.vals[probe]
      : undefined;
  const distance =
    sample?.cumulativeDistM ?? (chart && probe !== null ? chart.xs[probe] : 0);
  const showProbe = chart && probe !== null && typeof pv === 'number';

  return (
    <section
      className={`profile-pane${dial ? ' is-dial' : ''}${mode === 'readout' ? ' is-readout' : ''}`}
      aria-label={LABEL[metric]}
    >
      {(dial || mode === 'readout') && popBtn}
      {!dial && mode !== 'readout' && (
        <div className="pane-header">
          <b>{LABEL[metric]}</b>
          <span className="profile-readout">
            {chart && showProbe
              ? `${distance.toFixed(0)} m · ${pv!.toFixed(1)} ${unit}`
              : chart
                ? `${chart.min.toFixed(0)}-${chart.max.toFixed(0)} ${unit}`
                : ''}
          </span>
          {popBtn}
        </div>
      )}

      {mode === 'readout' ? (
        <TelemetryReadout clip={clip} probe={probe} sample={sample} />
      ) : dial ? (
        metric === 'alt' ? (
          <AltitudeCluster
            key={clip.id}
            clip={clip}
            probe={probe}
            sample={sample}
            playback={compact ? playback : undefined}
          />
        ) : (
          <SpeedCluster
            key={clip.id}
            clip={clip}
            probe={probe}
            sample={sample}
            playback={compact ? playback : undefined}
          />
        )
      ) : chart ? (
        <div
          className="profile-plot"
          onPointerDown={compact ? onMove : undefined}
          onPointerMove={onMove}
          // a lifted finger must not blank the playhead marker that the video is driving
          onPointerLeave={compact ? undefined : () => onProbe(null)}
          style={compact ? { touchAction: 'pan-y' } : undefined}
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
                className="profile-crosshair"
                style={
                  {
                    '--x': `${(distance / chart.total) * 100}%`,
                  } as CSSProperties
                }
              />
              <i
                className="profile-dot"
                style={
                  {
                    '--x': `${(distance / chart.total) * 100}%`,
                    '--y': `${(chart.py(pv!) / H) * 100}%`,
                  } as CSSProperties
                }
              />
            </>
          )}
        </div>
      ) : (
        <p className="video-hint is-padded">
          No {metric === 'alt' ? 'altitude' : 'speed'} data in this clip.
        </p>
      )}
    </section>
  );
}
