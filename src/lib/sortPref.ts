import { useSyncExternalStore } from 'react';
import { emitLocalChange } from './sync/changeBus';

/**
 * The clip list's sort order, as a small shared store (it used to be plain state in ClipToTrack, which sync
 * cannot reach). The sort KEYS belong to ClipToTrack; this store only checks the shape, and the list falls
 * back to its default when a key is unknown (e.g. one that arrives from a newer version of the app).
 */
export type SortPref = { key: string; dir: 1 | -1 };

const KEY = 'clip-to-track:sort';
const DEFAULT: SortPref = { key: 'added', dir: 1 };

export const isSortPref = (v: unknown): v is SortPref =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as SortPref).key === 'string' &&
  ((v as SortPref).dir === 1 || (v as SortPref).dir === -1);

const read = (): SortPref => {
  try {
    const s: unknown = JSON.parse(localStorage.getItem(KEY) ?? '');
    if (isSortPref(s)) return { key: s.key, dir: s.dir };
  } catch {
    /* default */
  }
  return DEFAULT;
};

let state = read();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

function write(next: SortPref) {
  state = { key: next.key, dir: next.dir };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const getSortPref = () => state;
/** the person picked a sort order: also reported to cloud sync */
export function setSortPref(next: SortPref) {
  write(next);
  emitLocalChange('sort');
}
/** a value from the cloud: applied like a normal change, but never reported back (no echo) */
export const applyRemoteSortPref = (next: SortPref) => isSortPref(next) && write(next);

export const useSortPref = () => useSyncExternalStore(subscribe, getSortPref, () => DEFAULT);
