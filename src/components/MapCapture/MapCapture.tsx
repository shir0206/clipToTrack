import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
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
import Icon from '../Icon/Icon';
import './MapCapture.css';

type Props = {
  target?: 'map' | 'telemetry';
  targetLabel?: string;
  filenameTarget?: string;
  headerHost?: HTMLElement;
  composition?: ReactNode;
  compositionZoom?: number;
  getSource: (position: CaptureStartPosition) => MapCaptureSource | null;
  playback: CapturePlayback;
  preparePlayback?: (
    position: CaptureStartPosition,
    signal: AbortSignal,
  ) => Promise<() => Promise<void>>;
  pausePlayback?: () => void;
  clipTitle: string;
  hasRoute: boolean;
  insetBottom: number;
  onClose: () => void;
};
type Phase = 'framing' | 'starting' | 'recording' | 'finalizing' | 'preview';
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function MapCapture(props: Props) {
  const target = props.targetLabel ?? props.target ?? 'map';
  const telemetry = props.target === 'telemetry';
  const [position, setPosition] = useState<CaptureStartPosition>('beginning');
  const startupAbort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('framing');
  const [finalizingPercent, setFinalizingPercent] = useState(0);
  const finalizingPreview = telemetry && phase === 'finalizing';
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
  const header = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
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
        : `Could not record the ${current.current.props.target ?? 'map'}. Please try again.`,
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
      current.current.props.pausePlayback?.();
      setPhase('finalizing');
      void active
        .stop()
        .then((value) => finish(value, reason))
        .catch(reportError);
    },
    [finish, reportError],
  );

  const layoutFrame = useCallback(() => {
    const box = root.current?.getBoundingClientRect();
    if (current.current.props.target === 'telemetry' && box) {
      const zoom = current.current.props.compositionZoom ?? 1;
      const width = Math.max(1, (box.width - 16) / zoom);
      const height = Math.max(
        1,
        Math.min(box.height - 16, ((box.width - 16) * 9) / 16 / zoom),
      );
      setFrame({
        x: (box.width - width) / 2,
        y: (box.height - height) / 2,
        width,
        height,
      });
      return;
    }
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const top = (header.current?.offsetHeight ?? 120) + (narrow ? 24 : 46);
    const bottom = (controls.current?.offsetHeight ?? 80) + (narrow ? 18 : 30);
    const available =
      (box?.height ?? 0) - current.current.props.insetBottom - top - bottom;
    if (!box || box.width <= 32 || available <= 20) {
      setFrame(null);
      return;
    }
    const rect = getLandscapeFrame(box.width - 32, available);
    setFrame({ ...rect, x: rect.x + 16, y: rect.y + top });
  }, []);

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
      const { phase: state } = current.current;
      if (state === 'recording' || state === 'starting') {
        stop('The capture area changed size.');
        return;
      }
      if (state !== 'framing') return;
      layoutFrame();
    };
    const observer = new ResizeObserver(resize);
    if (root.current) observer.observe(root.current);
    const panelObserver = new ResizeObserver(() => {
      if (current.current.phase === 'framing') layoutFrame();
    });
    if (header.current) panelObserver.observe(header.current);
    if (controls.current) panelObserver.observe(controls.current);
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
      panelObserver.disconnect();
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
  }, [stop, layoutFrame]);

  const previousInset = useRef(props.insetBottom);
  useEffect(() => {
    if (
      previousInset.current !== props.insetBottom &&
      (phase === 'recording' || phase === 'starting')
    )
      stop('The capture area changed size.');
    previousInset.current = props.insetBottom;
    if (phase === 'framing') layoutFrame();
  }, [phase, props.insetBottom, props.compositionZoom, stop, layoutFrame]);

  const recordingClip = useRef<string | null>(null);
  useEffect(() => {
    if (
      (phase === 'recording' || (!telemetry && phase === 'starting')) &&
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
    telemetry,
    props.playback.playing,
    props.playback.clipId,
    props.hasRoute,
    position,
    stop,
  ]);
  useEffect(() => {
    if ((phase === 'preview' || finalizingPreview) && !dialog.current?.open)
      dialog.current?.showModal();
  }, [phase, finalizingPreview]);

  const start = async () => {
    if (
      starting.current ||
      phase !== 'framing' ||
      !frame ||
      !support?.supported ||
      (!telemetry && position === 'current' && !props.playback.playing) ||
      !props.hasRoute
    )
      return;
    let source: MapCaptureSource | null;
    try {
      source = props.getSource(position);
    } catch (error) {
      reportError(error);
      return;
    }
    const box = root.current?.getBoundingClientRect();
    if (!source || !box) {
      setMessage(`Wait for the ${target} to finish loading, then try again.`);
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
    setFinalizingPercent(0);
    setPhase('starting');
    try {
      const resume = await props.preparePlayback?.(position, controller.signal);
      controller.signal.throwIfAborted();
      const bounds = source.canvas.getBoundingClientRect();
      const crop = telemetry
        ? {
            x: 0,
            y: 0,
            width: source.canvas.width,
            height: source.canvas.height,
          }
        : toCanvasCrop(
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
        onFinalizationProgress: (value) => {
          if (mounted.current && token === generation.current)
            setFinalizingPercent(value);
        },
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
    (telemetry || position === 'beginning' || props.playback.playing) &&
    props.hasRoute &&
    frame;
  const renderHeader = (content: ReactNode) =>
    props.headerHost ? createPortal(content, props.headerHost) : content;
  return (
    <div
      ref={root}
      className={`map-capture${telemetry ? ' telemetry-capture' : ''}`}
      aria-label={`${target} video capture`}
    >
      {phase !== 'preview' && !finalizingPreview && (
        <>
          {renderHeader(
            <div ref={header} className="map-capture-header">
              <div className="map-capture-heading">
                <span className="map-capture-symbol">
                  <Icon name="camera" size={18} />
                </span>
                <strong>
                  {phase === 'recording'
                    ? `Recording ${target}`
                    : phase === 'finalizing'
                      ? 'Preparing preview…'
                      : `Frame your ${target}`}
                </strong>
                <span className="map-capture-format-short">
                  1920 × 1080 · 25 fps
                </span>
              </div>
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
                    <Icon name="back" size={14} />
                    <span>From beginning</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="map-capture-position"
                      checked={position === 'current'}
                      onChange={() => setPosition('current')}
                    />
                    <Icon name="play" size={14} />
                    <span>From current position</span>
                  </label>
                </div>
              )}
              <small>
                <Icon name="clock" size={13} /> Up to 5 min · 256 MiB{' '}
                <span className="map-capture-tip">
                  {telemetry
                    ? 'Fit or zoom to compose'
                    : 'Pan and zoom to compose'}
                </span>
              </small>
            </div>,
          )}
          {frame && (
            <div
              className="map-capture-frame"
              aria-label={`${target} capture area`}
              style={{
                left: frame.x,
                top: frame.y,
                width: frame.width,
                height: frame.height,
              }}
            >
              {telemetry &&
                ['tl', 'tr', 'bl', 'br'].map((corner) => (
                  <i key={corner} className={`capture-corner ${corner}`} />
                ))}
              <span className="map-capture-frame-label" aria-hidden="true">
                <Icon name="fit" size={12} /> Capture area <b>16:9</b>
              </span>
            </div>
          )}
          <div
            ref={controls}
            className="map-capture-controls"
            style={{ bottom: props.insetBottom + 12 }}
          >
            <div
              className={`map-capture-message${canStart && !message && phase !== 'recording' ? ' is-ready-hint' : ''}`}
              role="status"
            >
              {message ||
                (!support ? (
                  'Checking video encoding support…'
                ) : !support.supported ? (
                  support.reason
                ) : !frame ? (
                  'Make more room for the map to frame a recording.'
                ) : !props.hasRoute ||
                  (!telemetry &&
                    position === 'current' &&
                    !props.playback.playing) ? (
                  'Select a video clip with a visible route, or play it to record from its current position.'
                ) : phase === 'recording' ? (
                  <>
                    <i className="map-recording-dot" />
                    {clock(seconds)}
                  </>
                ) : (
                  `Only the ${target} inside the frame will be recorded.`
                ))}
            </div>
            {phase === 'framing' && props.composition}
            <div className="map-capture-actions">
              {phase === 'framing' && (
                <button
                  className="map-capture-primary"
                  disabled={!canStart}
                  onClick={() => void start()}
                >
                  <Icon name="camera" size={16} />
                  Start recording
                </button>
              )}
              {phase === 'recording' && (
                <button className="map-capture-primary" onClick={() => stop()}>
                  <Icon name="stop" size={14} />
                  {telemetry ? 'Pause recording' : 'Stop & preview'}
                </button>
              )}
              {(phase === 'starting' || phase === 'finalizing') && (
                <span role="status">
                  {phase === 'starting' ? 'Starting…' : 'Finalizing MP4…'}
                </span>
              )}
              <button
                className="map-capture-dismiss"
                onClick={props.onClose}
                title={
                  phase === 'recording' || phase === 'finalizing'
                    ? 'Discard'
                    : 'Cancel'
                }
                aria-label={
                  phase === 'recording' || phase === 'finalizing'
                    ? 'Discard'
                    : 'Cancel'
                }
              >
                <Icon name="close" size={17} />
                <span className="map-capture-sr-only">
                  {phase === 'recording' || phase === 'finalizing'
                    ? 'Discard'
                    : 'Cancel'}
                </span>
              </button>
            </div>
          </div>
        </>
      )}
      {(preview || finalizingPreview) && (
        <dialog
          ref={dialog}
          className="map-capture-preview"
          aria-labelledby="map-capture-preview-title"
          aria-busy={finalizingPreview}
          onCancel={(event) => {
            event.preventDefault();
            props.onClose();
          }}
        >
          <div className="map-capture-preview-heading">
            <span className="map-capture-symbol">
              <Icon name="camera" size={20} />
            </span>
            <div>
              <span className="map-capture-eyebrow">
                {target.toUpperCase()} VIDEO
              </span>
              <h2 id="map-capture-preview-title">Preview {target} recording</h2>
            </div>
          </div>
          {preview ? (
            <>
              <p>
                1920 × 1080 · 25 fps ·{' '}
                {preview.recording.durationSeconds.toFixed(2)} seconds · No
                audio
              </p>
              {message && <p role="status">{message}</p>}
              <video
                src={preview.url}
                controls
                playsInline
                preload="metadata"
                aria-label={`${target} recording preview`}
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
                      `${title}-${props.filenameTarget ?? target}-1920x1080-25fps.mp4`,
                    );
                  }}
                >
                  <Icon name="download" size={16} />
                  Download MP4
                </button>
                <button onClick={retry}>
                  <Icon name="back" size={15} />
                  Record again
                </button>
                <button className="map-capture-discard" onClick={props.onClose}>
                  <Icon name="trash" size={15} />
                  Discard
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="map-capture-finalizing">
                <span className="map-capture-spinner" aria-hidden="true" />
                <strong role="status">Finalizing MP4</strong>
                <span className="map-capture-percent">
                  {finalizingPercent}%
                </span>
                <div
                  className="map-capture-progress"
                  role="progressbar"
                  aria-label="Finalizing MP4"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={finalizingPercent}
                >
                  <span style={{ width: `${finalizingPercent}%` }} />
                </div>
              </div>
              <div className="map-capture-actions">
                <button className="map-capture-discard" onClick={props.onClose}>
                  <Icon name="trash" size={15} />
                  Discard
                </button>
              </div>
            </>
          )}
        </dialog>
      )}
    </div>
  );
}
