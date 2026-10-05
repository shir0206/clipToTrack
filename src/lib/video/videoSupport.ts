/**
 * "Black square, but I hear sound" = the browser decodes the AUDIO (AAC) but not the VIDEO track
 * (GoPro HEVC / H.265, often 10-bit and up to 5.3K). The <video> element then neither errors nor
 * plays a picture, so the app has to notice it itself.
 *
 * watchPicture() reports it when
 *  - the file has no decodable video track (videoWidth === 0 after metadata), or
 *  - playback has run ~1.5 s without a single video frame being decoded.
 * Returns a cleanup function. Use it on every <video> (card, modal, popup window).
 */
export function watchPicture(
  v: HTMLVideoElement,
  onBroken: () => void,
): () => void {
  let timer = 0;
  const onMeta = () => {
    if (v.videoWidth === 0) onBroken();
  };
  const check = () => {
    if (v.paused || v.ended) return;
    const q = v.getVideoPlaybackQuality?.();
    if (q && q.totalVideoFrames === 0) onBroken();
  };
  const onPlaying = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, 1500);
  };
  const onPause = () => window.clearTimeout(timer);

  v.addEventListener('loadedmetadata', onMeta);
  v.addEventListener('playing', onPlaying);
  v.addEventListener('pause', onPause);
  return () => {
    window.clearTimeout(timer);
    v.removeEventListener('loadedmetadata', onMeta);
    v.removeEventListener('playing', onPlaying);
    v.removeEventListener('pause', onPause);
  };
}

export type DecodeProbe = 'ok' | 'no-picture';

/**
 * Plays the first moment of a file (muted, off-screen) and reports whether this browser can
 * really decode its picture. "ok" is also returned when the test is inconclusive (slow disk…),
 * so people are only bothered when we are sure.
 */
export function probeDecode(
  file: File,
  timeoutMs = 5000,
): Promise<DecodeProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(
      file.type ? file : new Blob([file], { type: 'video/mp4' }),
    );
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    let timer = 0;
    const finish = (r: DecodeProbe) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      v.pause();
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    timer = window.setTimeout(() => finish('ok'), timeoutMs);
    v.addEventListener('loadedmetadata', () => {
      if (v.videoWidth === 0) finish('no-picture');
    });
    v.addEventListener('error', () => finish('no-picture'));
    v.addEventListener('playing', () =>
      window.setTimeout(() => {
        const q = v.getVideoPlaybackQuality?.();
        finish(q && q.totalVideoFrames === 0 ? 'no-picture' : 'ok');
      }, 800),
    );
    v.src = url;
    v.play().catch((e: DOMException) => {
      if (e.name === 'NotSupportedError') finish('no-picture');
    });
  });
}

export type BrowserInfo = {
  family: 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
  /** shown to the user, e.g. "Chrome", "Brave" */
  name: string;
  os: 'windows' | 'mac' | 'linux' | 'other';
};

export function detectBrowser(): BrowserInfo {
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua)
    ? 'windows'
    : /Mac OS X|Macintosh/i.test(ua)
      ? 'mac'
      : /Linux|X11|CrOS/i.test(ua)
        ? 'linux'
        : 'other';
  if (/Edg\//.test(ua)) return { family: 'edge', name: 'Edge', os };
  if (/Firefox\//.test(ua)) return { family: 'firefox', name: 'Firefox', os };
  if ((navigator as { brave?: unknown }).brave)
    return { family: 'chrome', name: 'Brave', os };
  if (/OPR\//.test(ua)) return { family: 'chrome', name: 'Opera', os };
  if (/Chrome\//.test(ua)) return { family: 'chrome', name: 'Chrome', os };
  if (/Safari\//.test(ua)) return { family: 'safari', name: 'Safari', os };
  return { family: 'other', name: 'your browser', os };
}
