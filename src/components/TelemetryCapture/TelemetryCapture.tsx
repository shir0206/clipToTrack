import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Clip, GpsPoint } from '../../types';
import TelemetryView from '../ElevationProfile/TelemetryView';
import {
  hasTelemetry,
  telemetryConfig,
  type Metric,
  type ViewMode,
} from '../../lib/mapCapture/telemetryConfig';
import Icon from '../Icon/Icon';
import MapCapture from '../MapCapture/MapCapture';
import { RecordingTargetContext } from '../MapCapture/RecordingTargetContext';
import { telemetryTimeline } from '../../lib/mapCapture/telemetryTimeline';
import './TelemetryCapture.css';
import { createTelemetrySource } from './telemetrySource';

export default function TelemetryCapture({
  clip,
  probe,
  playback,
  metric = 'speed',
  mode = 'dial',
  onProbe,
  onPop,
  controlsHost,
  compact = false,
}: {
  clip: Clip;
  probe: number | null;
  metric?: Metric;
  mode?: ViewMode;
  onProbe?: (probe: number | null) => void;
  onPop?: () => void;
  controlsHost?: HTMLElement | null;
  compact?: boolean;
  playback?: { playing: boolean; onTogglePlay: () => void; onStop: () => void };
}) {
  const config = telemetryConfig(metric, mode);
  const usable = hasTelemetry(clip.samples, metric, mode);
  const owner = useId();
  const shared = useContext(RecordingTargetContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open =
    localOpen &&
    (!shared ||
      (shared.target === 'telemetry' &&
        (!shared.owner || shared.owner === owner)));
  const setOpen = (value: boolean) => {
    setLocalOpen(value);
    shared?.setTarget(value ? 'telemetry' : null, value ? owner : undefined);
  };
  const [headerHost, setHeaderHost] = useState<HTMLElement>();
  const [zoom, setZoom] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef<ReturnType<typeof createTelemetrySource> | null>(null);
  const heldProbe = useRef(0);
  const timeline = useMemo(
    () =>
      usable
        ? telemetryTimeline(clip.samples, clip.sort.duration ?? 0)
        : {
            duration: 0.04,
            timeAt: () => 0,
            at: () => ({ sample: clip.samples[0], probe: 0 }),
          },
    [clip, usable],
  );
  const [virtualPlaying, setVirtualPlaying] = useState(false);
  const [virtualTime, setVirtualTime] = useState<number | null>(null);
  const clock = useRef({ time: 0, started: null as number | null });
  const hasVideo = shared?.getCurrentTime?.(clip.id) !== undefined;
  const getTime = () =>
    hasVideo
      ? (shared!.getCurrentTime!(clip.id) ?? 0)
      : Math.min(
          timeline.duration,
          clock.current.time +
            (clock.current.started === null
              ? 0
              : (performance.now() - clock.current.started) / 1000),
        );
  const pause = () => {
    if (hasVideo) shared?.pausePlayback?.(clip.id);
    else {
      clock.current.time = getTime();
      clock.current.started = null;
      setVirtualTime(clock.current.time);
      setVirtualPlaying(false);
    }
  };
  useEffect(() => {
    if (!virtualPlaying) return;
    const timer = window.setInterval(() => {
      const time = Math.min(
        timeline.duration,
        clock.current.time +
          (clock.current.started === null
            ? 0
            : (performance.now() - clock.current.started) / 1000),
      );
      setVirtualTime(time);
      if (time >= timeline.duration) {
        clock.current.time = time;
        clock.current.started = null;
        setVirtualPlaying(false);
      }
    }, 40);
    return () => window.clearInterval(timer);
  }, [virtualPlaying, timeline.duration]);
  useEffect(() => {
    if (probe !== null) heldProbe.current = probe;
  }, [probe]);
  useEffect(
    () => () => {
      session.current?.dispose();
    },
    [clip.id, open],
  );
  const renderView = (
    viewProbe: number | null,
    sample?: GpsPoint,
    exporting = false,
  ) => (
    <TelemetryView
      clip={clip}
      metric={metric}
      mode={mode}
      probe={viewProbe}
      sample={sample}
      compact={compact}
      onProbe={exporting ? () => {} : (onProbe ?? (() => {}))}
      onPop={exporting ? undefined : onPop}
      playback={exporting ? undefined : playback}
    />
  );
  return (
    <div
      ref={stage}
      className={`telemetry-capture-stage${open ? ' is-framing' : ''}`}
    >
      {renderView(
        virtualTime === null || !open ? probe : timeline.at(virtualTime).probe,
        virtualTime === null || !open
          ? undefined
          : timeline.at(virtualTime).sample,
      )}
      {usable &&
        (!open || controlsHost !== undefined) &&
        (controlsHost === undefined ? (
          <button
            className={
              controlsHost !== undefined
                ? `map-chip${open ? ' is-on' : ''}`
                : 'map-chip telemetry-record-button'
            }
            title={`Record ${config.title}`}
            aria-label={`Record ${config.title}`}
            aria-pressed={open}
            onClick={() => {
              if (open) return;
              setHeaderHost(
                stage.current
                  ?.closest('.map-column')
                  ?.querySelector<HTMLElement>('.map-stage') ?? undefined,
              );
              setZoom(1);
              setVirtualTime(null);
              setOpen(true);
            }}
          >
            <Icon name="camera" size={14} />
          </button>
        ) : (
          controlsHost &&
          createPortal(
            <button
              className={
                controlsHost !== undefined
                  ? `map-chip${open ? ' is-on' : ''}`
                  : 'map-chip telemetry-record-button'
              }
              title={`Record ${config.title}`}
              aria-label={`Record ${config.title}`}
              aria-pressed={open}
              onClick={() => {
                if (open) return;
                setHeaderHost(
                  stage.current
                    ?.closest('.map-column')
                    ?.querySelector<HTMLElement>('.map-stage') ?? undefined,
                );
                setZoom(1);
                setVirtualTime(null);
                setOpen(true);
              }}
            >
              <Icon name="camera" size={14} />
            </button>,
            controlsHost,
          )
        ))}
      {open && (
        <MapCapture
          target="telemetry"
          targetLabel={config.label}
          filenameTarget={config.slug}
          getSource={(position) => {
            const element =
              stage.current?.querySelector<HTMLElement>('.profile-pane');
            if (!element) return null;
            session.current?.dispose();
            session.current = createTelemetrySource(
              clip,
              element,
              position === 'current' ? heldProbe.current : 0,
              zoom,
              position === 'current'
                ? hasVideo || virtualTime !== null
                  ? getTime()
                  : timeline.timeAt(heldProbe.current)
                : 0,
              getTime,
              (viewProbe, sample) => renderView(viewProbe, sample, true),
              mode === 'graph'
                ? getComputedStyle(element)
                    .getPropertyValue('--surface')
                    .trim() || '#fff'
                : '#000',
              compact,
            );
            return session.current.source;
          }}
          headerHost={shared?.headerHost ?? headerHost}
          compositionZoom={zoom}
          playback={
            hasVideo
              ? {
                  clipId: clip.id,
                  playing:
                    shared?.isPlaying?.(clip.id) ??
                    (shared?.playback
                      ? shared.playback.clipId === clip.id &&
                        shared.playback.playing
                      : (playback?.playing ?? false)),
                }
              : { clipId: clip.id, playing: virtualPlaying }
          }
          preparePlayback={async (position, signal) => {
            if (hasVideo && shared?.preparePlayback)
              return shared.preparePlayback(clip.id, position, signal);
            pause();
            clock.current.time =
              position === 'beginning'
                ? 0
                : virtualTime === null
                  ? timeline.timeAt(heldProbe.current)
                  : clock.current.time;
            setVirtualTime(clock.current.time);
            return async () => {
              signal.throwIfAborted();
              clock.current.started = performance.now();
              setVirtualPlaying(true);
            };
          }}
          pausePlayback={pause}
          clipTitle={clip.title}
          hasRoute={usable}
          insetBottom={0}
          composition={
            <div
              className="telemetry-zoom"
              role="group"
              aria-label="Composition"
            >
              <span className="telemetry-zoom-label">Zoom</span>
              <input
                aria-label={`${config.title} export zoom`}
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
              <output aria-hidden="true">{Math.round(zoom * 100)}%</output>
              <button
                className="telemetry-fit"
                onClick={() => setZoom(1)}
                aria-label={
                  mode === 'dial'
                    ? 'Fit dashboard'
                    : `Fit ${mode === 'graph' ? 'graph' : 'values'}`
                }
                title="Reset composition"
              >
                <Icon name="fit" size={14} />
              </button>
            </div>
          }
          onClose={() => {
            if (session.current) pause();
            setVirtualTime(null);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
