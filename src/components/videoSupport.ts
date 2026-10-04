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
