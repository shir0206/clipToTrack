export type CaptureStartPosition = 'beginning' | 'current';

/** Pause/seek before arming capture; playback resumes only when the caller is ready. */
export async function prepareCapturePlayback(
  video: HTMLVideoElement,
  position: CaptureStartPosition,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  signal.throwIfAborted();
  if (position === 'current') {
    if (video.paused || video.ended)
      throw new Error(
        'Play the clip before recording from the current position.',
      );
    return async () => {
      signal.throwIfAborted();
    };
  }
  video.pause();
  const wait = (event: 'loadedmetadata' | 'seeked', action?: () => void) =>
    new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener(event, done);
        video.removeEventListener('error', failed);
        signal.removeEventListener('abort', aborted);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('Could not prepare this video for recording.'));
      };
      const aborted = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(failed, 10000);
      video.addEventListener(event, done, { once: true });
      video.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', aborted, { once: true });
      try {
        signal.throwIfAborted();
        action?.();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  if (!video.readyState) await wait('loadedmetadata');
  if (video.currentTime > 0 || video.seeking)
    await wait('seeked', () => {
      video.currentTime = 0;
    });
  signal.throwIfAborted();
  return async () => {
    signal.throwIfAborted();
    await video.play();
    if (signal.aborted) {
      video.pause();
      signal.throwIfAborted();
    }
  };
}
