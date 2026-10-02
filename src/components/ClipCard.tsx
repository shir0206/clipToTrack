import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Clip } from './types';

type Props = {
  clip: Clip;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  onTogglePlay: () => void;
  onStop: () => void;
};

export default function ClipCard({
  clip,
  selected,
  playing,
  onSelect,
  onHover,
  onTogglePlay,
  onStop,
}: Props) {
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

  // `playing` (owned by the parent) is the single source of truth; the <video> just follows it
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch((e: DOMException) => {
        if (e.name === 'AbortError') return; // pause() raced play()
        setVideoError("This browser can't play this video (HEVC/10-bit often needs Safari or hardware support).");
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
    onStop();
  };
  const handleToggle = () => {
    setVideoError(null);
    onTogglePlay();
  };

  return (
    <li
      id={`ctt-${clip.id}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      aria-label={`Select track ${clip.index} ${clip.title}`}
      className={`ctt-card${selected ? ' is-selected' : ''}${playing ? ' is-playing' : ''}`}
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
              onStop();
            }}
            onError={() => {
              setVideoError("This browser can't play this video (HEVC/10-bit often needs Safari or hardware support).");
              onStop();
            }}
          />
        )}
        <span className="ctt-duration">{clip.duration}</span>
      </div>

      <div className="ctt-card-body">
        <div className="ctt-card-head">
          <span className="ctt-badge">{clip.index}</span>
          <div>
            <h3>{clip.title}</h3>
            <p>{clip.date}</p>
            <p>{clip.camera}</p>
          </div>
        </div>

        <div className="ctt-controls">
          <button
            className="ctt-btn ctt-btn-primary"
            aria-label={`${playing ? 'Pause' : 'Play'} ${clip.title}`}
            disabled={!canPlay}
            onClick={stop(handleToggle)}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            className="ctt-btn"
            aria-label={`Stop ${clip.title}`}
            disabled={!canPlay}
            onClick={stop(handleStop)}
          >
            ■
          </button>
          {playing && <span className="ctt-playing">Playing</span>}
          {!clip.videoUrl && <span className="ctt-hint">Re-add the MP4 to play</span>}
        </div>
        {videoError && <p className="ctt-video-error" role="status">{videoError}</p>}
      </div>

      <dl className="ctt-stats">
        <div>
          <dt>Duration</dt>
          <dd>{clip.duration}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{clip.distance}</dd>
        </div>
        <div>
          <dt>Max speed</dt>
          <dd>{clip.maxSpeed}</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd>{clip.altitude}</dd>
        </div>
      </dl>
      <p className="ctt-quality">{clip.gpsQuality}</p>
    </li>
  );
}
