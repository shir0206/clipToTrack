import { useEffect, useRef, type CSSProperties } from 'react';
import type { Clip } from './types';
import SvgIcon from './SvgIcon';

type Props = { clip: Clip; onClose: () => void; onProgress?: (frac: number) => void };

/** Large player for one clip. Esc / backdrop click / ✕ closes it. */
export default function VideoModal({ clip, onClose, onProgress }: Props) {
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    closeBtn.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ctt-modal" role="dialog" aria-modal="true" aria-label={clip.title} onClick={onClose}>
      <div className="ctt-modal-box" style={{ '--c': clip.color } as CSSProperties} onClick={(e) => e.stopPropagation()}>
        <div className="ctt-modal-head">
          <span className="ctt-badge">{clip.index}</span>
          <strong>{clip.title}</strong>
          <small>{clip.date} · {clip.camera}</small>
          <button ref={closeBtn} className="ctt-btn" aria-label="Close video" onClick={onClose}>
            <SvgIcon name="close" size={16} />
          </button>
        </div>
        <video className="ctt-modal-video" src={clip.videoUrl} poster={clip.thumbnail} controls autoPlay playsInline
          onTimeUpdate={(e) => e.currentTarget.duration && onProgress?.(e.currentTarget.currentTime / e.currentTarget.duration)}
        />
      </div>
    </div>
  );
}
