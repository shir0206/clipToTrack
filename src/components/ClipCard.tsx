import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Clip } from './types';
import SvgIcon, { type IconName } from './SvgIcon';

type Props = {
  clip: Clip;
  selected: boolean;
  playing: boolean;
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
};

const UNPLAYABLE =
  "This browser can't play this video (HEVC/10-bit often needs Safari or hardware support).";

export default function ClipCard({
  clip,
  selected,
  playing,
  onSelect,
  onHover,
  onTogglePlay,
  onStop,
  onMaximize,
  hidden,
  onToggleHidden,
  onProgress,
  onDelete,
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
      aria-label={`Select track ${clip.index} ${clip.title}`}
      className={`ctt-card${selected ? ' is-selected' : ''}${playing ? ' is-playing' : ''}${hidden ? ' is-hidden' : ''}`}
      style={{ '--c': clip.color } as CSSProperties}
      onClick={onSelect}
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
        className="ctt-thumb"
        style={
          clip.thumbnail
            ? { backgroundImage: `url(${clip.thumbnail})` }
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
        {clip.videoUrl && <span className="ctt-duration">{clip.duration}</span>}
      </div>

      <div className="ctt-card-body">
        <div className="ctt-card-head">
          <span className="ctt-badge">{clip.index}</span>
          <div>
            <div className="ctt-title-row">
              <h3>{clip.title}</h3>
              {playing && <span className="ctt-playing">Playing</span>}
            </div>
            <p>{clip.date}</p>
            <p className="ctt-meta">
              <SvgIcon name="camera" size={12} />
              {clip.camera}
            </p>
          </div>
        </div>

        <div className="ctt-controls">
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
