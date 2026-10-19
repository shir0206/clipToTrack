import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapCaptureSource } from '../TrackMap/TrackMap';
import type { CaptureStartPosition } from '../../lib/video/prepareCapturePlayback';
import type { CapturePlayback } from '../../lib/video/usePlaybackReporting';
import {
  getLandscapeFrame,
  toCanvasCrop,
  type CaptureRect,
} from '../../lib/mapCapture/captureGeometry';
import {
  checkMapCaptureSupport,
  createMapVideoRecorder,
  type MapCaptureSupport,
  type MapRecording,
  type MapVideoRecorder,
} from '../../lib/mapCapture/mapVideoRecorder';
import { download } from '../../lib/exportTrack';
import './MapCapture.css';

type Props = {
  getSource: () => MapCaptureSource | null;
  playback: CapturePlayback;
  preparePlayback?: (
    position: CaptureStartPosition,
    signal: AbortSignal,
  ) => Promise<() => Promise<void>>;
  clipTitle: string;
  hasRoute: boolean;
  insetBottom: number;
  onClose: () => void;
};
type Phase = 'framing' | 'starting' | 'recording' | 'finalizing' | 'preview';
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function MapCapture(props: Props) {
  const [position, setPosition] = useState<CaptureStartPosition>('beginning');
  const startupAbort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('framing');
  const [support, setSupport] = useState<MapCaptureSupport | null>(null);
  const [frame, setFrame] = useState<CaptureRect | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{
    recording: MapRecording;
    url: string;
    title: string;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const recorder = useRef<MapVideoRecorder | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const mounted = useRef(false);
  const current = useRef({ props, phase });
  const previewUrl = useRef<string | null>(null);
  const recordedTitle = useRef('');
  useEffect(() => {
    current.current = { props, phase };
  });

  const releasePreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
  }, []);
  const finish = useCallback((recording: MapRecording, reason = '') => {
    if (!mounted.current) return;
    recorder.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    const url = URL.createObjectURL(recording.blob);
    previewUrl.current = url;
    setPreview({ recording, url, title: recordedTitle.current });
    setMessage(reason);
    setPhase('preview');
  }, []);
  const reportError = useCallback((error: unknown) => {
    if (!mounted.current) return;
    recorder.current = null;
    setMessage(
      error instanceof Error
        ? error.message
        : 'Could not record the map. Please try again.',
    );
    setPhase('framing');
  }, []);
  const stop = useCallback(
    (reason = '') => {
      const active = recorder.current;
      if (current.current.phase === 'starting') {
        startupAbort.current?.abort();
        generation.current++;
        active?.cancel();
        recorder.current = null;
        setMessage(reason);
        setPhase('framing');
        return;
      }
      if (!active) return;
      setPhase('finalizing');
      void active
        .stop()
        .then((value) => finish(value, reason))
        .catch(reportError);
    },
    [finish, reportError],
  );

  useEffect(() => {
    mounted.current = true;
    const session = generation;
    const previousFocus = document.activeElement as HTMLElement | null;
    root.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
    void checkMapCaptureSupport().then((value) => {
      if (mounted.current) setSupport(value);
    });
    const resize = () => {
      const { props: latest, phase: state } = current.current;
      if (state === 'recording' || state === 'starting') {
        stop('The capture area changed size.');
        return;
      }
      if (state !== 'framing') return;
      const box = root.current?.getBoundingClientRect();
      if (!box || box.width <= 32 || box.height - latest.insetBottom <= 260) {
        setFrame(null);
        return;
      }
      const rect = getLandscapeFrame(
        box.width - 32,
        box.height - latest.insetBottom - 260,
      );
      setFrame({ ...rect, x: rect.x + 16, y: rect.y + 145 });
    };
    const observer = new ResizeObserver(resize);
    if (root.current) observer.observe(root.current);
    resize();
    const visibility = () => {
      if (document.hidden)
        stop('Recording stopped because this tab became hidden.');
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && current.current.phase !== 'preview')
        current.current.props.onClose();
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('orientationchange', resize);
    return () => {
      mounted.current = false;
      session.current++;
      observer.disconnect();
      document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('orientationchange', resize);
      startupAbort.current?.abort();
      recorder.current?.cancel();
      recorder.current = null;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    };
  }, [stop]);

  const previousInset = useRef(props.insetBottom);
  useEffect(() => {
    if (
      previousInset.current !== props.insetBottom &&
      (phase === 'recording' || phase === 'starting')
    )
      stop('The capture area changed size.');
    previousInset.current = props.insetBottom;
    if (phase === 'framing') {
      // Recompute after retry and after mobile sheet movement without resizing the stage.
      const box = root.current?.getBoundingClientRect();
      if (box && box.width > 32 && box.height - props.insetBottom > 260) {
        const rect = getLandscapeFrame(
          box.width - 32,
          box.height - props.insetBottom - 260,
        );
        setFrame({ ...rect, x: rect.x + 16, y: rect.y + 145 });
      } else setFrame(null);
    }
  }, [phase, props.insetBottom, stop]);

  const recordingClip = useRef<string | null>(null);
  useEffect(() => {
    if (
      (phase === 'recording' || phase === 'starting') &&
      ((!props.playback.playing &&
        (phase === 'recording' || position === 'current')) ||
        props.playback.clipId !== recordingClip.current ||
        !props.hasRoute)
    )
      stop(
        'Recording stopped because playback paused or the active clip changed.',
      );
  }, [
    phase,
    props.playback.playing,
    props.playback.clipId,
    props.hasRoute,
    position,
    stop,
  ]);
  useEffect(() => {
    if (phase === 'preview') dialog.current?.showModal();
  }, [phase]);

  const start = async () => {
    if (
      starting.current ||
      phase !== 'framing' ||
      !frame ||
      !support?.supported ||
      (position === 'current' && !props.playback.playing) ||
      !props.hasRoute
    )
      return;
    const source = props.getSource();
    const box = root.current?.getBoundingClientRect();
    if (!source || !box) {
      setMessage('Wait for the map to finish loading, then try again.');
      return;
    }
    starting.current = true;
    const token = ++generation.current;
    const controller = new AbortController();
    startupAbort.current = controller;
    recordingClip.current = props.playback.clipId;
    recordedTitle.current = props.clipTitle;
    setMessage('');
    setSeconds(0);
    setPhase('starting');
    try {
      const resume = await props.preparePlayback?.(position, controller.signal);
      controller.signal.throwIfAborted();
      const bounds = source.canvas.getBoundingClientRect();
      const crop = toCanvasCrop(
        {
          ...frame,
          x: frame.x + box.left - bounds.left,
          y: frame.y + box.top - bounds.top,
        },
        bounds.width,
        bounds.height,
        source.canvas.width,
        source.canvas.height,
      );
      let finishedBeforeReady = false;
      const active = await createMapVideoRecorder({
        ...source,
        crop,
        onProgress: (value) => {
          if (mounted.current && token === generation.current)
            setSeconds(value);
        },
        onStatus: (state) => {
          if (state === 'canceled' || state === 'stopped')
            finishedBeforeReady = true;
          if (
            mounted.current &&
            token === generation.current &&
            state === 'finalizing'
          )
            setPhase('finalizing');
        },
        onStopped: (value, reason) => {
          if (token === generation.current) finish(value, reason);
        },
        onError: (error) => {
          if (token === generation.current) {
            recorder.current?.cancel();
            reportError(error);
          }
        },
      });
      if (!mounted.current || token !== generation.current) {
        active.cancel();
        return;
      }
      if (finishedBeforeReady) {
        active.cancel();
        return;
      }
      recorder.current = active;
      await active.ready;
      controller.signal.throwIfAborted();
      await resume?.();
      controller.signal.throwIfAborted();
      setPhase('recording');
    } catch (error) {
      if (token === generation.current) {
        recorder.current?.cancel();
        reportError(error);
      }
    } finally {
      starting.current = false;
    }
  };
  const retry = () => {
    releasePreview();
    setMessage('');
    setPhase('framing');
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus(),
    );
  };
  const canStart =
    support?.supported &&
    (position === 'beginning' || props.playback.playing) &&
    props.hasRoute &&
    frame;
  return (
    <div ref={root} className="map-capture" aria-label="Map video capture">
      {phase !== 'preview' && (
        <>
          <div className="map-capture-header">
            <strong>
              {phase === 'recording'
                ? 'Recording map'
                : phase === 'finalizing'
                  ? 'Preparing preview…'
                  : 'Frame your map'}
            </strong>
            <span>1920 × 1080 · 25 fps · Landscape · No audio</span>
            {phase === 'framing' && (
              <div
                role="radiogroup"
                aria-label="Recording start"
                className="map-capture-start-position"
              >
                <label>
                  <input
                    type="radio"
                    name="map-capture-position"
                    checked={position === 'beginning'}
                    onChange={() => setPosition('beginning')}
                  />
                  From beginning
                </label>
                <label>
                  <input
                    type="radio"
                    name="map-capture-position"
                    checked={position === 'current'}
                    onChange={() => setPosition('current')}
                  />
                  From current position
                </label>
              </div>
            )}
            <small>
              Maximum 5 minutes or 256 MiB. Pan and zoom to compose.
            </small>
          </div>
          {frame && (
            <div
              className="map-capture-frame"
              aria-label="Map capture area"
              style={{
                left: frame.x,
                top: frame.y,
                width: frame.width,
                height: frame.height,
              }}
            />
          )}
          <div
            className="map-capture-controls"
            style={{ bottom: props.insetBottom + 12 }}
          >
            <div className="map-capture-message" role="status">
              {message ||
                (!support ? (
                  'Checking video encoding support…'
                ) : !support.supported ? (
                  support.reason
                ) : !frame ? (
                  'Make more room for the map to frame a recording.'
                ) : !props.hasRoute ||
                  (position === 'current' && !props.playback.playing) ? (
                  'Select a video clip with a visible route, or play it to record from its current position.'
                ) : phase === 'recording' ? (
                  <>
                    <i className="map-recording-dot" />
                    {clock(seconds)}
                  </>
                ) : (
                  'Only the map inside the frame will be recorded.'
                ))}
            </div>
            <div className="map-capture-actions">
              {phase === 'framing' && (
                <button
                  className="map-capture-primary"
                  disabled={!canStart}
                  onClick={() => void start()}
                >
                  Start recording
                </button>
              )}
              {phase === 'recording' && (
                <button className="map-capture-primary" onClick={() => stop()}>
                  Stop &amp; preview
                </button>
              )}
              {(phase === 'starting' || phase === 'finalizing') && (
                <span role="status">
                  {phase === 'starting' ? 'Starting…' : 'Finalizing MP4…'}
                </span>
              )}
              <button onClick={props.onClose}>
                {phase === 'recording' || phase === 'finalizing'
                  ? 'Discard'
                  : 'Cancel'}
              </button>
            </div>
          </div>
        </>
      )}
      {preview && (
        <dialog
          ref={dialog}
          className="map-capture-preview"
          aria-labelledby="map-capture-preview-title"
          onCancel={(event) => {
            event.preventDefault();
            props.onClose();
          }}
        >
          <h2 id="map-capture-preview-title">Preview map recording</h2>
          <p>
            1920 × 1080 · 25 fps ·{' '}
            {preview.recording.durationSeconds.toFixed(2)} seconds · No audio
          </p>
          {message && <p role="status">{message}</p>}
          <video
            src={preview.url}
            controls
            playsInline
            preload="metadata"
            aria-label="Map recording preview"
          />
          <div className="map-capture-actions">
            <button
              className="map-capture-primary"
              onClick={() => {
                const title =
                  preview.title
                    .replace(/[<>:"/\\|?*]/g, '-')
                    .split('')
                    .map((char) => (char.charCodeAt(0) < 32 ? '-' : char))
                    .join('')
                    .trim()
                    .replace(/\.[^.]+$/, '')
                    .slice(0, 120) || 'clip';
                download(
                  preview.recording.blob,
                  `${title}-map-1920x1080-25fps.mp4`,
                );
              }}
            >
              Download MP4
            </button>
            <button onClick={retry}>Record again</button>
            <button onClick={props.onClose}>Discard</button>
          </div>
        </dialog>
      )}
    </div>
  );
}
