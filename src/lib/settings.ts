import { useSyncExternalStore } from 'react';

/** Which parts of the map UI are shown. Everything is on by default. */
export type ViewSettings = {
  /** place search box */
  search: boolean;
  /** basemap / colour-by / points dropdowns */
  mapStyle: boolean;
  /** start-end, arrows, relief, focus, follow, profile toggles */
  layers: boolean;
  /** measure, fit, fullscreen, export */
  tools: boolean;
  /** colour-scale legend (when colouring by speed / altitude) */
  legend: boolean;
  /** lat, lon readout in the corner */
  coords: boolean;
  /** zoom +/- buttons and compass */
  zoom: boolean;
  /** "show my location" (GPS) button */
  gps: boolean;
  /** 3D terrain button */
  terrain: boolean;
  /** distance scale bar */
  scale: boolean;
};

export type AppSettings = { view: ViewSettings };

export const DEFAULT_SETTINGS: AppSettings = {
  view: {
    search: true,
    mapStyle: true,
    layers: true,
    tools: true,
    legend: true,
    coords: true,
    zoom: true,
    gps: true,
    terrain: true,
    scale: true,
  },
};

const KEY = 'clip-to-track:settings:v1';

const load = (): AppSettings => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { view: { ...DEFAULT_SETTINGS.view, ...s.view } };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

// tiny external store: the settings dialog (header) and the map toolbar read the same state
let state = load();
const listeners = new Set<() => void>();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const getSnapshot = () => state;

function commit(next: AppSettings) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const setView = (patch: Partial<ViewSettings>) =>
  commit({ ...state, view: { ...state.view, ...patch } });
/** show (true) or hide (false) every map UI element at once */
export const setAllView = (on: boolean) =>
  commit({
    ...state,
    view: Object.fromEntries(
      (Object.keys(DEFAULT_SETTINGS.view) as (keyof ViewSettings)[]).map(
        (k) => [k, on],
      ),
    ) as ViewSettings,
  });
export const resetView = () =>
  commit({ ...state, view: DEFAULT_SETTINGS.view });

export const useSettings = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
