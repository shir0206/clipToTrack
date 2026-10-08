import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Clip } from '../../types';
import Icon, { type IconName } from '../Icon/Icon';
import { watchPicture } from '../../lib/video/videoSupport';
import { CLIP_MIME } from '../../lib/projects';
import { clipColorVars } from '../../lib/clipColorStyle';

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
  /** 'stacked' = phone layout (thumbnail on top). Default 'row' = desktop. */
  layout?: 'row' | 'stacked';
  /** phone: opens the "move to project" picker (replaces drag and drop) */
  onMove?: () => void;
  /** phone: opens the playback help dialog from the error message */
  onHelp?: () => void;
  /** phone: lets the person pick the video file again after a reload */
  onReAddVideo?: (file: File) => void;
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
  layout = 'row',
  onMove,
  onHelp,
  onReAddVideo,
}: Props) {
  const stacked = layout === 'stacked';
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  // phones cap concurrent decoders: only the selected / playing card mounts a <video>
  const mountVideo =
    !!clip.videoUrl &&
    !videoError &&
    (!stacked || playing || selected || nowPlaying);
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
  }, [clip.videoUrl, videoError, mountVideo]);

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
  }, [playing, mountVideo]);

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
  }, [playing, mountVideo]);

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
      className={`clip-card is-${layout}${selected ? ' is-selected' : ''}${active ? ' is-playing' : ''}${hidden ? ' is-hidden' : ''}`}
      style={clipColorVars(clip.color) as CSSProperties}
      onClick={onSelect}
      draggable={!!onDragStart && !stacked}
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
        className={`clip-thumbnail${canPlay ? ' is-playable' : ''}`}
        style={
          clip.thumbnail
            ? ({ '--thumbnail': `url(${clip.thumbnail})` } as CSSProperties)
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
        {mountVideo && (
          <video
            ref={videoRef}
            className="video-frame"
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
        {!clip.videoUrl &&
          (onReAddVideo ? (
            <button
              className="thumbnail-hint is-action"
              onClick={(e) => {
                e.stopPropagation();
                pick.current?.click();
              }}
            >
              The video isn’t kept after a reload. Tap to add it again
            </button>
          ) : (
            <span
              className="thumbnail-hint"
              title="The video file isn't kept after a reload — add it again to play"
            >
              Re-add video to play
            </span>
          ))}
        {onReAddVideo && (
          <input
            ref={pick}
            type="file"
            accept=".mp4,.lrv,video/mp4"
            hidden
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReAddVideo(f);
              e.target.value = '';
            }}
          />
        )}
      </div>

      <div className="card-body">
        <div className="card-header">
          <div className="header-group">
            <div className="project-title">
              <div className="title-row">
                <span className="track-badge" />
                <h3>{clip.title}</h3>
              </div>
              <button
                className="icon-button button-spacer"
                aria-label={`${hidden ? 'Show' : 'Hide'} ${clip.title} on map`}
                aria-pressed={hidden}
                title={hidden ? 'Show on map' : 'Hide on map'}
                onClick={stop(onToggleHidden)}
              >
                <Icon name={hidden ? 'eyeOff' : 'eye'} size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${clip.title}`}
                title="Delete clip"
                aria-expanded={confirming}
                onClick={stop(() => setConfirming((c) => !c))}
              >
                <Icon name="trash" size={14} />
              </button>
              {stacked && onMove && (
                <button
                  className="icon-button"
                  aria-label={`More actions for ${clip.title}`}
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  onClick={stop(() => setMenu((m) => !m))}
                >
                  <span aria-hidden="true">⋯</span>
                </button>
              )}
            </div>
            {menu && (
              <div
                className="card-actions"
                role="menu"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  role="menuitem"
                  onClick={stop(() => {
                    setMenu(false);
                    onMove?.();
                  })}
                >
                  <Icon name="folder" size={14} /> Move to project…
                </button>
                <button
                  role="menuitem"
                  onClick={stop(() => {
                    setMenu(false);
                    onToggleHidden();
                  })}
                >
                  <Icon name={hidden ? 'eye' : 'eyeOff'} size={14} />
                  {hidden ? 'Show on map' : 'Hide on map'}
                </button>
                <button
                  role="menuitem"
                  className="is-danger"
                  onClick={stop(() => {
                    setMenu(false);
                    setConfirming(true);
                  })}
                >
                  <Icon name="trash" size={14} /> Delete…
                </button>
              </div>
            )}
            {place && (
              <p className="card-meta">
                <Icon name="mapPin" size={14} />
                {place}
              </p>
            )}
            <p className="card-meta">
              <Icon name="calendar" size={12} />
              {clip.date}
            </p>
            <p className="card-meta">
              <Icon name="camera" size={12} />
              {clip.camera}
            </p>
          </div>
        </div>

        <div className="card-controls">
          <div className="control-buttons">
            <button
              className="icon-button is-primary"
              aria-label={`${playing ? 'Pause' : 'Play'} ${clip.title}`}
              disabled={!canPlay}
              onClick={stop(handleToggle)}
            >
              <Icon name={playing ? 'pause' : 'play'} size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={`Stop ${clip.title}`}
              disabled={!canPlay}
              onClick={(e) => {
                e.stopPropagation();
                handleStop();
              }}
            >
              <Icon name="stop" size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={`Maximize ${clip.title}`}
              title="Open larger"
              disabled={!canPlay}
              onClick={stop(onMaximize)}
            >
              <Icon name="maximize" size={14} />
            </button>
          </div>
          {active && (
            <span className="playing-indicator" role="status">
              <span className="equalizer" aria-hidden="true">
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
            className="confirm-bar"
            role="alertdialog"
            aria-label={`Delete ${clip.title}?`}
            onClick={(e) => e.stopPropagation()}
          >
            <span>Remove from map and saved data?</span>
            <button
              className="confirm-accept"
              autoFocus
              onClick={stop(onDelete)}
            >
              Delete
            </button>
            <button
              className="confirm-cancel"
              onClick={stop(() => setConfirming(false))}
            >
              Cancel
            </button>
          </div>
        )}
        {videoError && (
          <p className="video-error" role="status">
            {videoError}
            {onHelp && (
              <>
                {' '}
                <button className="link-button" onClick={stop(onHelp)}>
                  How to fix
                </button>
              </>
            )}
          </p>
        )}
      </div>

      <dl className="card-stats">
        {stats.map(([icon, label, value]) => (
          <div key={label} className="stat-item">
            <Icon name={icon} size={16} />
            <div>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          </div>
        ))}
      </dl>

      <p className="quality-label">
        <Icon name="gps" size={12} />
        {clip.gpsQuality}
      </p>

      {!!clip.details?.length && (
        <details className="more-menu" onClick={(e) => e.stopPropagation()}>
          <summary>
            <Icon name="info" size={14} />
            More details
            <Icon name="chevron" size={14} className="chevron-icon" />
          </summary>
          {clip.details.map((g) => (
            <section key={g.title} className="more-group">
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
