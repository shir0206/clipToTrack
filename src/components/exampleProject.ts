import { useSyncExternalStore } from 'react';
import type { ClipMetadata } from '../lib/gopro/clipFromMetadata';

/**
 * Example project: 2-3 small sample clips that ship with the repo.
 *  - telemetry: pre-made JSON in src/data/example/<name>.json (lazy chunks, never parsed from the MP4)
 *  - video:     public/assets/example/<name>.mp4 (streamed by <video>, nothing is downloaded up front)
 *  - thumbnail: public/assets/example/<name>.jpg
 * The JSON files define which clips exist. See PLAN.md.
 */
const ASSET_DIR = `${import.meta.env.BASE_URL}assets/example/`;
// missing files are fine at build time: glob just returns what exists
const META_FILES = import.meta.glob<ClipMetadata>('../data/example/*.json', {
  import: 'default',
});

export type ExampleClip = {
  metadata: ClipMetadata;
  videoUrl?: string;
  thumbnail?: string;
};
export type ExampleLoad = { clips: ExampleClip[]; missing: string[] };

const EXAMPLE_PLACE = 'Tyrol/Austria';
const EXAMPLE_TRIPS = [
  'Ride',
  'Drive',
  'Road trip',
  'Weekend',
  'Mountain loop',
  'Scenic route',
  'Valley tour',
  'Alpine pass',
  'Sunday drive',
  'Adventure',
];
/** e.g. "Scenic route in Tyrol/Austria". The word "Example" is not in the name: the UI shows an "Example" badge instead. */
export const randomExampleName = () =>
  `${EXAMPLE_TRIPS[Math.floor(Math.random() * EXAMPLE_TRIPS.length)]} in ${EXAMPLE_PLACE}`;

// ───────── what the app remembers about the example ─────────
type ExampleState = {
  /** the Settings switch; off = never add it again on its own */
  enabled: boolean;
  /** null = not added yet */
  projectId: string | null;
  /** the clips that belong to the example, so turning it off removes only those */
  clipIds: string[];
  /** clip id -> static video url, to give the video back after a reload */
  videos: Record<string, string>;
};

const KEY = 'clip-to-track:example';
const EMPTY: ExampleState = {
  enabled: true,
  projectId: null,
  clipIds: [],
  videos: {},
};
const read = (): ExampleState => {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...EMPTY };
  }
};

let state = read();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const exampleState = () => state;
export const setExampleState = (patch: Partial<ExampleState>) => {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
};
export const useExampleState = () =>
  useSyncExternalStore(subscribe, exampleState);

// ───────── loading ─────────
/** Does the static file exist? (a dev/SPA server answers 200 + html for unknown paths, so check the type) */
async function exists(url: string, type: 'video/' | 'image/') {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith(type);
  } catch {
    return true; // offline: don't report a file as missing just because the check failed
  }
}

function useuppercase(filename: string) {
  return filename.replace(/\.(mp4|lrv)$/i, (extension) =>
    extension.toLocaleLowerCase(),
  );
}

async function firstExistingVideo(filename: string) {
  const candidates = [...new Set([filename, useuppercase(filename)])];
  for (const candidate of candidates) {
    if (await exists(`${ASSET_DIR}${candidate}`, 'video/')) return candidate;
  }
  return null;
}

/** All example clips that can be built, plus a list of what is missing. Never throws for missing files. */
export async function loadExampleClips(): Promise<ExampleLoad> {
  const paths = Object.keys(META_FILES).sort();
  const missing: string[] = [];
  if (!paths.length)
    missing.push('src/data/example/*.json (no telemetry files)');

  const clips = await Promise.all(
    paths.map(async (path): Promise<ExampleClip> => {
      const name = path
        .split('/')
        .pop()!
        .replace(/\.json$/i, '');
      const metadata = await META_FILES[path]();
      const videoFileName = metadata.source?.fileName ?? `${name}.mp4`;
      const resolvedVideoFileName = await firstExistingVideo(videoFileName);
      const thumbUrl = `${ASSET_DIR}${name}.jpg`;
      const hasThumb = await exists(thumbUrl, 'image/');
      if (!resolvedVideoFileName)
        missing.push(`public/assets/example/${videoFileName}`);
      if (!hasThumb) missing.push(`public/assets/example/${name}.jpg`);
      return {
        metadata,
        videoUrl: resolvedVideoFileName
          ? `${ASSET_DIR}${resolvedVideoFileName}`
          : undefined,
        thumbnail: hasThumb ? thumbUrl : undefined,
      };
    }),
  );
  if (missing.length && import.meta.env.DEV)
    console.warn('[example project] missing files:', missing);
  return { clips, missing };
}

// ───────── dev only: generate the JSON + thumbnails from your MP4s ─────────
if (import.meta.env.DEV) {
  (
    window as unknown as { exportExampleMetadata: () => void }
  ).exportExampleMetadata = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,.mp4,.lrv';
    input.multiple = true;
    input.onchange = () =>
      void import('../lib/example/exportExampleMetadata').then((m) =>
        m.exportExampleMetadata(Array.from(input.files ?? [])),
      );
    input.click();
  };
}
