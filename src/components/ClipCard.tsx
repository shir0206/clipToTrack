import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Clip } from './types';
import SvgIcon, { type IconName } from './SvgIcon';
import { watchPicture } from './videoSupport';
import { CLIP_MIME } from './projects';

type Props = {
  clip: Clip;
  /** town / city of the clip's start, shown after the file name once looked up */
  place?: string;
  selected: boolean;
  playing: boolean;
  /** true while this clip plays in the large player (popup / modal); only drives the visuals */
  nowPlaying?: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onMaximize: () => void;
  hidden: boolean;
  onToggleHidden: () => void;
  /** 0..1 position of the video while playing (null = cleared); drives the map playhead */
  onProgress: (frac: number | null) => void;
  /** removes the clip from the map and from localStorage */
  onDelete: () => void;
  /** the card can be dragged onto a project (see ProjectBar) */
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

const UNPLAYABLE =
  "This PC can't decode the picture of this video (GoPro HEVC / 10-bit). Windows: use Edge with “HEVC Video Extensions” installed, or add the clip's .LRV proxy (H.264) instead.";

export default function ClipCard({
  clip,
  place,
  selected,
  playing,
  nowPlaying = false,
  onSelect,
  onHover,
  onTogglePlay,
  onStop,
  onMaximize,
  hidden,
  onToggleHidden,
  onProgress,
  onDelete,
  onDragStart,
  onDragEnd,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const onStopRef = useRef(onStop);
  useEffect(() => {
    onStopRef.current = onStop;
  });

  // audio-only playback (video track not decodable) never raises an error by itself: detect it
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    return watchPicture(v, () => {
      v.pause();
      setVideoError(UNPLAYABLE);
      onStopRef.current();
    });
  }, [clip.videoUrl, videoError]);

  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  });
  useEffect(() => {
    const v = videoRef.current;
    if (!playing || !v) return;
    let raf = 0;
    const tick = () => {
      if (v.duration) onProgressRef.current(v.currentTime / v.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // `playing` (owned by the parent) is the single source of truth; the <video> just follows it
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch((e: DOMException) => {
        if (e.name === 'AbortError') return; // pause() raced play()
        setVideoError(UNPLAYABLE);
        onStopRef.current();
      });
    } else {
      v.pause();
    }
  }, [playing]);

  const active = playing || nowPlaying; // visuals only; `playing` alone controls the inline <video>
  const canPlay = !!clip.videoUrl && !videoError;
  const handleStop = () => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
    onProgress(null);
    onStop();
  };
  const handleToggle = () => {
    setVideoError(null);
    onTogglePlay();
  };

  const stats: [IconName, string, string][] = [
    ['clock', 'Duration', clip.duration],
    ['route', 'Distance', clip.distance],
    ['gauge', 'Max speed', clip.maxSpeed],
    ['mountain', 'Altitude', clip.altitude],
  ];

  return (
    <li
      id={`ctt-${clip.id}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      aria-label={`Select track ${clip.index} ${clip.title}${place ? ` - ${place}` : ''}`}
      className={`ctt-card${selected ? ' is-selected' : ''}${active ? ' is-playing' : ''}${hidden ? ' is-hidden' : ''}`}
      style={{ '--c': clip.color } as CSSProperties}
      onClick={onSelect}
      draggable={!!onDragStart}
      onDragStart={(e) => {
        e.dataTransfer.setData(CLIP_MIME, clip.id);
        e.dataTransfer.setData('text/plain', clip.title);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // let the inner buttons handle their own keys
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div
        className={`ctt-thumb${canPlay ? ' is-playable' : ''}`}
        style={
          clip.thumbnail
            ? { backgroundImage: `url(${clip.thumbnail})` }
            : undefined
        }
        onClick={
          canPlay
            ? (e) => {
                e.stopPropagation();
                onMaximize(); // opens the video in its own window
              }
            : undefined
        }
      >
        {clip.videoUrl && !videoError && (
          <video
            ref={videoRef}
            className="ctt-video"
            src={clip.videoUrl}
            poster={clip.thumbnail}
            preload="metadata"
            playsInline
            onEnded={() => {
              if (videoRef.current) videoRef.current.currentTime = 0;
              onProgress(null);
              onStop();
            }}
            onError={() => {
              setVideoError(UNPLAYABLE);
              onStop();
            }}
          />
        )}
        {!clip.videoUrl && (
          <span
            className="ctt-thumb-hint"
            title="The video file isn't kept after a reload — add it again to play"
          >
            Re-add video to play
          </span>
        )}
      </div>

      <div className="ctt-card-body">
        <div className="ctt-card-head">
          <div className="ctt-card-head-container">
            <div className="ctt-phead-title">
              <div className="ctt-title-row">
                <span className="ctt-badge" />
                <h3>{clip.title}</h3>
              </div>
              <button
                className="ctt-btn ctt-btn-spacer"
                aria-label={`${hidden ? 'Show' : 'Hide'} ${clip.title} on map`}
                aria-pressed={hidden}
                title={hidden ? 'Show on map' : 'Hide on map'}
                onClick={stop(onToggleHidden)}
              >
                <SvgIcon name={hidden ? 'eyeOff' : 'eye'} size={15} />
              </button>
              <button
                className="ctt-btn"
                aria-label={`Delete ${clip.title}`}
                title="Delete clip"
                aria-expanded={confirming}
                onClick={stop(() => setConfirming((c) => !c))}
              >
                <SvgIcon name="trash" size={14} />
              </button>
            </div>
            {place && (
              <p className="ctt-meta">
                <SvgIcon name="mapPin" size={14} />
                {place}
              </p>
            )}
            <p className="ctt-meta">
              <SvgIcon name="calendar" size={12} />
              {clip.date}
            </p>
            <p className="ctt-meta">
              <SvgIcon name="camera" size={12} />
              {clip.camera}
            </p>
          </div>
        </div>

        <div className="ctt-controls">
          <div className="ctt-controls-btns">
            <button
              className="ctt-btn ctt-btn-primary"
              aria-label={`${playing ? 'Pause' : 'Play'} ${clip.title}`}
              disabled={!canPlay}
              onClick={stop(handleToggle)}
            >
              <SvgIcon name={playing ? 'pause' : 'play'} size={14} />
            </button>
            <button
              className="ctt-btn"
              aria-label={`Stop ${clip.title}`}
              disabled={!canPlay}
              onClick={(e) => {
                e.stopPropagation();
                handleStop();
              }}
            >
              <SvgIcon name="stop" size={13} />
            </button>
            <button
              className="ctt-btn"
              aria-label={`Maximize ${clip.title}`}
              title="Open larger"
              disabled={!canPlay}
              onClick={stop(onMaximize)}
            >
              <SvgIcon name="maximize" size={14} />
            </button>
          </div>
          {active && (
            <span className="ctt-playing" role="status">
              <span className="ctt-eq" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Playing
            </span>
          )}
        </div>
        {confirming && (
          <div
            className="ctt-confirm"
            role="alertdialog"
            aria-label={`Delete ${clip.title}?`}
            onClick={(e) => e.stopPropagation()}
          >
            <span>Remove from map and saved data?</span>
            <button
              className="ctt-confirm-yes"
              autoFocus
              onClick={stop(onDelete)}
            >
              Delete
            </button>
            <button
              className="ctt-confirm-no"
              onClick={stop(() => setConfirming(false))}
            >
              Cancel
            </button>
          </div>
        )}
        {videoError && (
          <p className="ctt-video-error" role="status">
            {videoError}
          </p>
        )}
      </div>

      <dl className="ctt-stats">
        {stats.map(([icon, label, value]) => (
          <div key={label} className="ctt-stat">
            <SvgIcon name={icon} size={16} />
            <div>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          </div>
        ))}
      </dl>

      <p className="ctt-quality">
        <SvgIcon name="gps" size={12} />
        {clip.gpsQuality}
      </p>

      {!!clip.details?.length && (
        <details className="ctt-more" onClick={(e) => e.stopPropagation()}>
          <summary>
            <SvgIcon name="info" size={14} />
            More details
            <SvgIcon name="chevron" size={14} className="ctt-chev" />
          </summary>
          {clip.details.map((g) => (
            <section key={g.title} className="ctt-more-group">
              <h4>{g.title}</h4>
              <dl>
                {g.rows.map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </details>
      )}
    </li>
  );
}
