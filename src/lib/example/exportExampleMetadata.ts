import type { ClipMetadata } from '../gopro/clipFromMetadata';
import { extractGoProMetadata } from '../gopro/extractGoProMetadata';
import { captureThumbnail } from '../video/videoThumbnail';

/** Keeps the example JSON (and localStorage) small. */
const MAX_POINTS = 1000;

function thin(m: ClipMetadata): ClipMetadata {
  const t = m.gps.track;
  const step = Math.max(1, Math.ceil(t.length / MAX_POINTS));
  const track = t.filter((_, i) => i % step === 0 || i === t.length - 1);
  return { ...m, gps: { ...m.gps, samples: m.gps.samples ?? t.length, track } };
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * DEV ONLY (called through `exportExampleMetadata()` in the browser console).
 * For each MP4: downloads <name>.json and <name>.jpg. The MP4 file name must be the final one
 * (it becomes part of the clip id).
 */
export async function exportExampleMetadata(files: File[]) {
  for (const file of files) {
    const name = file.name.replace(/\.[^.]+$/, '');
    try {
      const metadata = thin(await extractGoProMetadata(file));
      save(
        new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
        `${name}.json`,
      );
      const url = URL.createObjectURL(
        file.type ? file : new Blob([file], { type: 'video/mp4' }),
      );
      const dataUrl = await captureThumbnail(url);
      URL.revokeObjectURL(url);
      save(await (await fetch(dataUrl)).blob(), `${name}.jpg`);
      console.info(`[example] ${name}: json + jpg downloaded`);
    } catch (e) {
      console.error(`[example] ${file.name} failed`, e);
    }
  }
}
