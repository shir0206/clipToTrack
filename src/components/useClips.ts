import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clipFromMetadata, type ClipMetadata } from './clipFromMetadata';
import { extractGoProMetadata } from './extractGoProMetadata';
import { captureThumbnail } from './videoThumbnail';
import type { Clip } from './types';

const STORAGE_KEY = 'clip-to-track:clips:v1';
/** 10 Hz GPS on a long clip would blow the ~5 MB localStorage quota, so stored tracks are capped. */
const MAX_TRACK_POINTS = 2000;

/** What we keep per clip. The MP4 itself can't live in localStorage, so videoUrl is session-only. */
type Entry = { metadata: ClipMetadata; thumbnail?: string; videoUrl?: string };
type Stored = Pick<Entry, 'metadata' | 'thumbnail'>;

/** Slim the track to what the app reads (lat/lon/alt/speed/utc) and cap its length. Summary stats are untouched. */
function compact(m: ClipMetadata): ClipMetadata {
  const t = m.gps.track;
  const step = Math.max(1, Math.ceil(t.length / MAX_TRACK_POINTS));
  const track = t
    .filter((_, i) => i % step === 0 || i === t.length - 1)
    .map(({ lat, lon, altM, speed3dKmh, utc }) => ({ lat, lon, altM, speed3dKmh, utc }));
  return { ...m, gps: { ...m.gps, samples: m.gps.samples ?? t.length, track } };
}

function load(): Entry[] {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(arr)) return [];
    return (arr as Stored[]).filter((e) => {
      try {
        clipFromMetadata(e.metadata);
        return true;
      } catch {
        return false; // drop corrupted entries instead of crashing the app
      }
    });
  } catch {
    return [];
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

export function useClips() {
  const [entries, setEntries] = useState<Entry[]>(load);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Clip = pure function of the stored metadata (+ session-only video URL)
  const clips: Clip[] = useMemo(
    () =>
      entries.map((e, i) => ({
        ...clipFromMetadata(e.metadata, i + 1),
        thumbnail: e.thumbnail,
        videoUrl: e.videoUrl,
      })),
    [entries],
  );

  // persist (JSON only — no video blobs)
  useEffect(() => {
    try {
      const stored: Stored[] = entries.map(({ metadata, thumbnail }) => ({ metadata, thumbnail }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      setError('Browser storage is full — clips will be lost on reload. Remove some clips.');
    }
  }, [entries]);

  // revoke object URLs that are no longer referenced
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(entries.map((e) => e.videoUrl).filter((u): u is string => !!u));
    urls.current.forEach((u) => {
      if (!live.has(u)) {
        URL.revokeObjectURL(u);
        urls.current.delete(u);
      }
    });
    live.forEach((u) => urls.current.add(u));
  }, [entries]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  /** Accepts GoPro .mp4 files (telemetry is extracted) or metadata .json. Resolves to the first added clip id. */
  const addFiles = useCallback(async (files: File[]): Promise<string | undefined> => {
    setBusy(true);
    const added: (Entry & { id: string })[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        if (/\.json$/i.test(file.name)) {
          const metadata = compact(JSON.parse(await file.text()));
          added.push({ metadata, id: clipFromMetadata(metadata).id });
        } else {
          const metadata = compact(await extractGoProMetadata(file));
          const id = clipFromMetadata(metadata).id; // validates too
          const videoUrl = URL.createObjectURL(file);
          const thumbnail = await captureThumbnail(videoUrl);
          added.push({ metadata, thumbnail, videoUrl, id });
        }
      } catch (e) {
        errors.push(`${file.name}: ${message(e)}`);
      }
    }

    setError(errors.length ? errors.join(' · ') : null);
    if (added.length)
      setEntries((prev) => {
        // same id (file name + GPS start) replaces in place; keep an existing video/thumbnail if the new one has none
        const byId = new Map(prev.map((e) => [clipFromMetadata(e.metadata).id, e]));
        for (const { id, ...next } of added) {
          const old = byId.get(id);
          byId.set(id, {
            metadata: next.metadata,
            thumbnail: next.thumbnail ?? old?.thumbnail,
            videoUrl: next.videoUrl ?? old?.videoUrl,
          });
        }
        return [...byId.values()];
      });
    setBusy(false);
    return added[0]?.id;
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    setError(null);
  }, []);

  return { clips, error, busy, addFiles, clear };
}
