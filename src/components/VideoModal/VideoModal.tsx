import { useEffect, useRef, type CSSProperties } from 'react';
import type { Clip } from '../../types';
import Icon from '../Icon/Icon';
import { clipColorVars } from '../../lib/clipColorStyle';

type Props = {
  clip: Clip;
  onClose: () => void;
  onProgress?: (frac: number) => void;
  onPlayingChange?: (playing: boolean) => void;
};

const toggle = (v: HTMLVideoElement) => {
  if (v.paused) v.play().catch(() => {});
  else v.pause();
};

/** Large player for one clip. Esc / backdrop click / ✕ closes it. */
export default function VideoModal({
  clip,
  onClose,
  onProgress,
  onPlayingChange,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // no native toolbar: click / Space = play-pause, ← → = seek 5 s, Esc = close
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (e.key === 'Escape') onClose();
      else if (!v) return;
      else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        toggle(v);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const to = v.currentTime + (e.key === 'ArrowRight' ? 5 : -5);
        v.currentTime = Math.max(0, Math.min(to, v.duration || to));
      }
    };
    window.addEventListener('keydown', onKey);
    box.current?.focus(); // not the ✕ button, so Space doesn't "press" it
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="video-modal"
      role="dialog"
      aria-modal="true"
      aria-label={clip.title}
      onClick={onClose}
    >
      <div
        ref={box}
        tabIndex={-1}
        className="modal-box"
        style={clipColorVars(clip.color) as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="track-badge">{clip.index}</span>
          <strong>{clip.title}</strong>
          <small>
            {clip.date} · {clip.camera}
          </small>
          <button
            className="icon-button"
            aria-label="Close video"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <video
          ref={videoRef}
          className="modal-video"
          src={clip.videoUrl}
          poster={clip.thumbnail}
          autoPlay
          onClick={(e) => toggle(e.currentTarget)}
          playsInline
          onPlay={() => onPlayingChange?.(true)}
          onPause={() => onPlayingChange?.(false)}
          onEnded={() => onPlayingChange?.(false)}
          onTimeUpdate={(e) =>
            e.currentTarget.duration &&
            onProgress?.(e.currentTarget.currentTime / e.currentTarget.duration)
          }
        />
      </div>
    </div>
  );
}
