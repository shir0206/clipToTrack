import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clipFromMetadata, type ClipMetadata } from './clipFromMetadata';
import { extractGoProMetadata, NoGpsFixError } from './extractGoProMetadata';
import { pickAnchors } from './gpsBridge';
import { captureThumbnail } from './videoThumbnail';
import type { Clip, UploadProgress } from './types';

const STORAGE_KEY = 'clip-to-track:clips:v1';
/** 10 Hz GPS on a long clip would blow the ~5 MB localStorage quota, so stored tracks are capped. */
const MAX_TRACK_POINTS = 2000;

/** What we keep per clip. The MP4 itself can't live in localStorage, so videoUrl is session-only. */
type Entry = {
  metadata: ClipMetadata;
  thumbnail?: string;
  videoUrl?: string;
  addedAt: number;
  /** Permanent colour slot (1-based). Assigned once on add, never recomputed from list position. */
  slot: number;
};
type Stored = Pick<Entry, 'metadata' | 'thumbnail'> & {
  addedAt?: number;
  slot?: number;
};

/** Cap the track length (all per-point fields are kept for the hover bubble). Summary stats are untouched. */
function compact(m: ClipMetadata): ClipMetadata {
  const t = m.gps.track;
  const step = Math.max(1, Math.ceil(t.length / MAX_TRACK_POINTS));
  const track = t.filter((_, i) => i % step === 0 || i === t.length - 1);
  return { ...m, gps: { ...m.gps, samples: m.gps.samples ?? t.length, track } };
}

function load(): Entry[] {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(arr)) return [];
    return (
      (arr as Stored[])
        // clips saved before slots existed keep the colour they had (their position + 1)
        .map((e, i) => ({
          ...e,
          addedAt: e.addedAt ?? 0,
          slot: e.slot ?? i + 1,
        }))
        .filter((e) => {
          try {
            clipFromMetadata(e.metadata);
            return true;
          } catch {
            return false; // drop corrupted entries instead of crashing the app
          }
        })
    );
  } catch {
    return [];
  }
}

const message = (e: unknown) =>
  e instanceof Error ? e.message : 'unknown error';

export function useClips() {
  const [entries, setEntries] = useState<Entry[]>(load);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const entriesRef = useRef(entries); // lets addFiles see current clips without re-creating the callback
  useEffect(() => {
    entriesRef.current = entries;
  });

  // Clip = pure function of the stored metadata (+ session-only video URL)
  const clips: Clip[] = useMemo(
    () =>
      entries.map((e, i) => ({
        ...clipFromMetadata(e.metadata, i + 1, e.slot),
        thumbnail: e.thumbnail,
        videoUrl: e.videoUrl,
        addedAt: e.addedAt,
      })),
    [entries],
  );

  // persist (JSON only — no video blobs)
  useEffect(() => {
    try {
      const stored: Stored[] = entries.map(
        ({ metadata, thumbnail, addedAt, slot }) => ({
          metadata,
          thumbnail,
          addedAt,
          slot,
        }),
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Persistence failure is discovered only while synchronizing entries to localStorage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        'Browser storage is full — clips will be lost on reload. Remove some clips.',
      );
    }
  }, [entries]);

  // revoke object URLs that are no longer referenced
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(
      entries.map((e) => e.videoUrl).filter((u): u is string => !!u),
    );
    urls.current.forEach((u) => {
      if (!live.has(u)) {
        URL.revokeObjectURL(u);
        urls.current.delete(u);
      }
    });
    live.forEach((u) => urls.current.add(u));
  }, [entries]);
  useEffect(
    () => () => urls.current.forEach((u) => URL.revokeObjectURL(u)),
    [],
  );

  /** Accepts GoPro .mp4 files (telemetry is extracted) or metadata .json. Resolves to the ids of every clip added (upload order). */
  const addFiles = useCallback(async (files: File[]): Promise<string[]> => {
    setBusy(true);
    const added: (Omit<Entry, 'slot'> & { id: string })[] = [];
    const errors: string[] = [];
    // clips without any GPS fix (tunnel…): placed afterwards, between the clips that do have one
    const unlocated: {
      file: File;
      err: NoGpsFixError;
      videoUrl: string;
      thumbnail?: string;
    }[] = [];
    const asVideoUrl = (f: File) =>
      URL.createObjectURL(f.type ? f : new Blob([f], { type: 'video/mp4' }));

    for (let n = 0; n < files.length; n++) {
      const file = files[n];
      const base = { name: file.name, n: n + 1, of: files.length };
      setProgress({ ...base, phase: 'index', frac: null });
      try {
        if (/\.json$/i.test(file.name)) {
          const metadata = compact(JSON.parse(await file.text()));
          added.push({
            metadata,
            id: clipFromMetadata(metadata).id,
            addedAt: Date.now(),
          });
        } else {
          const metadata = compact(
            await extractGoProMetadata(file, (p) =>
              setProgress({
                ...base,
                phase: p.phase,
                frac:
                  p.phase === 'telemetry' && p.total ? p.done / p.total : null,
              }),
            ),
          );
          const id = clipFromMetadata(metadata).id; // validates too
          // .lrv has no MIME type; label it so <video> doesn't have to guess (wrapping a File in a Blob copies nothing)
          const videoUrl = asVideoUrl(file);
          setProgress({ ...base, phase: 'thumbnail', frac: null });
          const thumbnail = await captureThumbnail(videoUrl);
          added.push({
            metadata,
            thumbnail,
            videoUrl,
            id,
            addedAt: Date.now(),
          });
        }
      } catch (e) {
        if (e instanceof NoGpsFixError) {
          const videoUrl = asVideoUrl(file);
          setProgress({ ...base, phase: 'thumbnail', frac: null });
          const thumbnail = await captureThumbnail(videoUrl).catch(
            () => undefined,
          );
          unlocated.push({ file, err: e, videoUrl, thumbnail });
        } else errors.push(`${file.name}: ${message(e)}`);
      }
    }

    // tunnel clips: interpolate between the real-fix clips just before / after them
    for (const u of unlocated) {
      const { startMs, endMs, place } = u.err.info;
      const metas = [
        ...entriesRef.current.map((e) => e.metadata),
        ...added.map((a) => a.metadata),
      ];
      const { prev, next } =
        startMs !== undefined && endMs !== undefined
          ? pickAnchors(metas, startMs, endMs)
          : {};
      if (!prev && !next && !u.err.info.canPlaceAlone) {
        errors.push(`${u.file.name}: ${u.err.message}`);
        URL.revokeObjectURL(u.videoUrl);
        continue;
      }
      const metadata = compact(place(prev, next));
      added.push({
        metadata,
        thumbnail: u.thumbnail,
        videoUrl: u.videoUrl,
        id: clipFromMetadata(metadata).id,
        addedAt: Date.now(),
      });
    }

    setError(errors.length ? errors.join(' · ') : null);
    if (added.length)
      setEntries((prev) => {
        // same id (file name + GPS start) replaces in place; keep an existing video/thumbnail if the new one has none
        const byId = new Map(
          prev.map((e) => [clipFromMetadata(e.metadata).id, e]),
        );
        // a new clip takes the lowest colour slot nobody is using; a re-added clip keeps its own
        const used = new Set(prev.map((e) => e.slot));
        const freeSlot = () => {
          let n = 1;
          while (used.has(n)) n++;
          used.add(n);
          return n;
        };
        for (const { id, ...next } of added) {
          const old = byId.get(id);
          byId.set(id, {
            metadata: next.metadata,
            thumbnail: next.thumbnail ?? old?.thumbnail,
            videoUrl: next.videoUrl ?? old?.videoUrl,
            addedAt: next.addedAt,
            slot: old?.slot ?? freeSlot(),
          });
        }
        return [...byId.values()];
      });
    setProgress(null);
    setBusy(false);
    return added.map((a) => a.id);
  }, []);

  /** Removes one clip from state and (via the persist effect) from localStorage; its object URL is revoked too. */
  const remove = useCallback((id: string) => {
    setEntries((prev) =>
      prev.filter((e) => clipFromMetadata(e.metadata).id !== id),
    );
    setError(null);
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    setError(null);
  }, []);

  return { clips, error, busy, progress, addFiles, remove, clear };
}
