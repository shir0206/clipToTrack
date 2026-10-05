import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Clip } from './types';

const ROOT_ID = 'ctt-video-root';

/**
 * Opens an empty, resizable popup. Must be called synchronously from a click handler,
 * otherwise the browser's popup blocker will refuse it. Returns null if blocked.
 */
export function openVideoWindow(title: string): Window | null {
  const w = Math.min(960, window.screen.availWidth - 80);
  const h = Math.round((w * 9) / 16);
  const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
  const win = window.open(
    '',
    '_blank',
    `popup=yes,resizable=yes,width=${w},height=${h},left=${left},top=${top}`,
  );
  if (!win) return null;

  const doc = win.document;
  doc.title = title;
  doc.head.innerHTML = `
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
      #${ROOT_ID} { width: 100vw; height: 100vh; display: flex; }
      video { width: 100%; height: 100%; object-fit: contain; background: #000; outline: none; cursor: pointer; }
    </style>`;
  doc.body.innerHTML = `<div id="${ROOT_ID}"></div>`;
  return win;
}

const toggle = (v: HTMLVideoElement) => {
  if (v.paused) v.play().catch(() => {});
  else v.pause();
};

function setVideoWindowTitle(win: Window, title: string) {
  win.document.title = title;
}

type Props = {
  clip: Clip;
  win: Window;
  /** called when the user closes the popup (the parent also closes it itself when needed) */
  onClose: () => void;
  onProgress?: (frac: number) => void;
  /** true while the video is actually playing (drives the card's "playing" animation) */
  onPlayingChange?: (playing: boolean) => void;
};

/** Renders the clip's <video> (and nothing else) into a separate browser window via a portal. */
export default function VideoWindow({
  clip,
  win,
  onClose,
  onProgress,
  onPlayingChange,
}: Props) {
  const [root] = useState(() => win.document.getElementById(ROOT_ID));
  const videoRef = useRef<HTMLVideoElement>(null);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  });

  // Smooth playhead: `timeupdate` only fires ~4x/s, so poll every frame instead.
  // Use the popup's own rAF - the main window's rAF can be throttled while the popup covers it.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && v.duration && !v.paused)
        onProgressRef.current?.(v.currentTime / v.duration);
      raf = win.requestAnimationFrame(tick);
    };
    raf = win.requestAnimationFrame(tick);
    return () => win.cancelAnimationFrame(raf);
  }, [win]);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setVideoWindowTitle(win, clip.title);
  }, [win, clip.title]);

  useEffect(() => {
    let notified = false;
    const notify = () => {
      if (notified) return;
      notified = true;
      onCloseRef.current();
    };
    // no native toolbar: click / Space = play-pause, ← → = seek 5 s, Esc = close
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (e.key === 'Escape') win.close();
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
    win.addEventListener('pagehide', notify); // user closed the window
    win.addEventListener('keydown', onKey);
    // fallback for browsers that don't fire pagehide on popups reliably
    const poll = window.setInterval(() => win.closed && notify(), 500);
    // closing/reloading the main page takes the popup with it
    const closeWithParent = () => win.close();
    window.addEventListener('pagehide', closeWithParent);
    win.focus();
    return () => {
      notified = true; // unmount must not report a user close
      clearInterval(poll);
      window.removeEventListener('pagehide', closeWithParent);
      win.removeEventListener('pagehide', notify);
      win.removeEventListener('keydown', onKey);
      // the parent closes the window explicitly (closeMax/openMax), so StrictMode re-runs don't kill it
    };
  }, [win]);

  if (!root) return null;
  return createPortal(
    <video
      ref={videoRef}
      src={clip.videoUrl}
      poster={clip.thumbnail}
      autoPlay
      onClick={(e) => toggle(e.currentTarget)}
      playsInline
      onPlay={() => onPlayingChange?.(true)}
      onPause={() => onPlayingChange?.(false)}
      onEnded={() => onPlayingChange?.(false)}
      // still report on seek/pause so the playhead lands exactly where the video is
      onSeeked={(e) =>
        e.currentTarget.duration &&
        onProgress?.(e.currentTarget.currentTime / e.currentTarget.duration)
      }
    />,
    root,
  );
}
