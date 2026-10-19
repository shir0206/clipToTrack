import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareCapturePlayback } from './prepareCapturePlayback';

class Video extends EventTarget {
  readyState = 1;
  paused = true;
  ended = false;
  seeking = false;
  autoSeek = true;
  position = 5;
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(async () => {
    this.paused = false;
  });
  get currentTime() {
    return this.position;
  }
  set currentTime(value: number) {
    this.position = value;
    if (this.autoSeek)
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
  }
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const media = (video: Video) => video as unknown as HTMLVideoElement;

it('rewinds and holds playback at zero until the recorder is ready', async () => {
  const video = new Video();
  video.paused = false;
  const resume = await prepareCapturePlayback(
    media(video),
    'beginning',
    new AbortController().signal,
  );
  expect(video.currentTime).toBe(0);
  expect(video.paused).toBe(true);
  expect(video.play).not.toHaveBeenCalled();
  await resume();
  expect(video.play).toHaveBeenCalledOnce();
  expect(video.paused).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it('starts from a paused zero position without waiting for a seek event', async () => {
  const video = new Video();
  video.position = 0;
  const resume = await prepareCapturePlayback(
    media(video),
    'beginning',
    new AbortController().signal,
  );
  await resume();
  expect(video.currentTime).toBe(0);
  expect(video.play).toHaveBeenCalledOnce();
});
it('leaves current-position playback and its time unchanged', async () => {
  const video = new Video();
  video.paused = false;
  const resume = await prepareCapturePlayback(
    media(video),
    'current',
    new AbortController().signal,
  );
  await resume();
  expect(video.currentTime).toBe(5);
  expect(video.pause).not.toHaveBeenCalled();
  expect(video.play).not.toHaveBeenCalled();
});
it('requires a playing clip for current-position recording', async () => {
  await expect(
    prepareCapturePlayback(
      media(new Video()),
      'current',
      new AbortController().signal,
    ),
  ).rejects.toThrow('Play the clip');
});
it('aborts a pending seek and releases its timeout', async () => {
  const video = new Video();
  video.autoSeek = false;
  const controller = new AbortController();
  const result = prepareCapturePlayback(
    media(video),
    'beginning',
    controller.signal,
  );
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(video.play).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('does not resume after cancellation while the recorder is being prepared', async () => {
  const video = new Video();
  const controller = new AbortController();
  const resume = await prepareCapturePlayback(
    media(video),
    'beginning',
    controller.signal,
  );
  controller.abort();
  await expect(resume()).rejects.toMatchObject({ name: 'AbortError' });
  expect(video.play).not.toHaveBeenCalled();
});
it('reports a seek timeout and playback rejection', async () => {
  const video = new Video();
  video.autoSeek = false;
  const result = prepareCapturePlayback(
    media(video),
    'beginning',
    new AbortController().signal,
  );
  const assertion = expect(result).rejects.toThrow('Could not prepare');
  await vi.advanceTimersByTimeAsync(10000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
  video.position = 0;
  video.play.mockRejectedValueOnce(new Error('Playback blocked'));
  const resume = await prepareCapturePlayback(
    media(video),
    'beginning',
    new AbortController().signal,
  );
  await expect(resume()).rejects.toThrow('Playback blocked');
});
