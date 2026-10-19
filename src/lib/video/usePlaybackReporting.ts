import { useEffect, useRef, type RefObject } from 'react';

export type CapturePlayback = { clipId: string | null; playing: boolean };

/** Reports actual media advancement, including buffering and player removal. */
export function usePlaybackReporting(
  videoRef: RefObject<HTMLVideoElement | null>,
  onChange: ((playing: boolean) => void) | undefined,
  source: string | undefined,
  mounted = true,
) {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mounted) return;
    const started = () => callback.current?.(true);
    const stopped = () => callback.current?.(false);
    const stopEvents = [
      'pause',
      'ended',
      'waiting',
      'seeking',
      'emptied',
      'error',
    ] as const;
    video.addEventListener('playing', started);
    stopEvents.forEach((event) => video.addEventListener(event, stopped));
    return () => {
      video.removeEventListener('playing', started);
      stopEvents.forEach((event) => video.removeEventListener(event, stopped));
      stopped();
    };
  }, [videoRef, source, mounted]);
}
