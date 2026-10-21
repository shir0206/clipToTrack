import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Clip } from '../../types';
import SpeedCluster from '../SpeedCluster/SpeedCluster';
import Icon from '../Icon/Icon';
import MapCapture from '../MapCapture/MapCapture';
import { RecordingTargetContext } from '../MapCapture/RecordingTargetContext';
import { speedometerTimeline } from '../../lib/mapCapture/speedometerTimeline';
import { createSpeedometerSource } from './speedometerSource';

export default function SpeedometerCapture({
  clip,
  probe,
  playback,
}: {
  clip: Clip;
  probe: number | null;
  playback?: { playing: boolean; onTogglePlay: () => void; onStop: () => void };
}) {
  const owner = useId();
  const shared = useContext(RecordingTargetContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open =
    localOpen &&
    (!shared ||
      (shared.target === 'speedometer' &&
        (!shared.owner || shared.owner === owner)));
  const setOpen = (value: boolean) => {
    setLocalOpen(value);
    shared?.setTarget(value ? 'speedometer' : null, value ? owner : undefined);
  };
  const [headerHost, setHeaderHost] = useState<HTMLElement>();
  const [zoom, setZoom] = useState(1);
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef<ReturnType<typeof createSpeedometerSource> | null>(
    null,
  );
  const heldProbe = useRef(0);
  const timeline = useMemo(
    () =>
      clip.samples.some((p) => Number.isFinite(p.speed3dKmh ?? p.speed3dMs))
        ? speedometerTimeline(clip.samples, clip.sort.duration ?? 0)
        : {
            duration: 0.04,
            timeAt: () => 0,
            at: () => ({ sample: clip.samples[0], probe: 0 }),
          },
    [clip],
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
  const usable = clip.samples.some((p) =>
    Number.isFinite(p.speed3dKmh ?? p.speed3dMs),
  );
  return (
    <div
      ref={stage}
      className={`speedometer-capture-stage${open ? ' is-framing' : ''}`}
    >
      <SpeedCluster
        clip={clip}
        probe={
          virtualTime === null || !open ? probe : timeline.at(virtualTime).probe
        }
        sample={
          virtualTime === null || !open
            ? undefined
            : timeline.at(virtualTime).sample
        }
        playback={playback}
      />
      {!open && usable && (
        <button
          className="map-chip speedometer-record-button"
          title="Record Speedometer"
          onClick={() => {
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
          <Icon name="camera" size={14} /> Record Speedometer
        </button>
      )}
      {open && (
        <MapCapture
          target="speedometer"
          getSource={(position) => {
            const element =
              stage.current?.querySelector<HTMLElement>('.gauge-cluster');
            if (!element) return null;
            session.current?.dispose();
            session.current = createSpeedometerSource(
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
            <label className="speedometer-zoom">
              Composition{' '}
              <input
                aria-label="Speedometer export zoom"
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />{' '}
              <button onClick={() => setZoom(1)}>Fit dashboard</button>
            </label>
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
