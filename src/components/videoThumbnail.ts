/** Grabs a small JPEG data-URL frame from a video URL. Resolves undefined if the browser can't decode it. */
export function captureThumbnail(
  url: string,
  width = 320,
  timeoutMs = 8000,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;

    let timer: ReturnType<typeof setTimeout>;
    const done = (result?: string) => {
      clearTimeout(timer);
      v.onerror = v.onloadeddata = v.onseeked = null;
      v.removeAttribute('src');
      v.load(); // release the decoder
      resolve(result);
    };
    timer = setTimeout(() => done(), timeoutMs);

    v.onerror = () => done();
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.1, (v.duration || 0) / 2);
    };
    v.onseeked = () => {
      try {
        const w = Math.min(width, v.videoWidth);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = Math.round((w * v.videoHeight) / v.videoWidth);
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.7));
      } catch {
        done();
      }
    };
    v.src = url;
  });
}
