import { useSyncExternalStore } from 'react';

/**
 * "Satellite map by default" preference (Settings → Map). On unless the person turned it off.
 * Small shared store, same pattern as the project-mode switch, so Settings and the map agree.
 */
const KEY = 'clip-to-track:satellite-default:v1';

let on = (() => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
})();
const listeners = new Set<() => void>();

export const satelliteDefault = () => on;

export function setSatelliteDefault(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const useSatelliteDefault = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    satelliteDefault,
    () => true,
  );
