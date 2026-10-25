import type { SyncField } from './syncKeys';
import { applyRemoteSettings, DEFAULT_SETTINGS, getSettings, type AppSettings } from '../settings';
import { applyRemoteSatelliteDefault, satelliteDefault } from '../../config/mapDefault';
import { applyRemoteProjectMode, getProjectMode } from '../../hooks/useProjects';
import { applyRemoteExampleEnabled, exampleState } from '../../components/ExampleProject/exampleProject';
import { applyRemotePlaybackHelpDismissed, playbackHelpDismissed } from '../../components/playback/PlaybackHelp';
import { applyRemoteMapOpts, DEFAULT_OPTS, loadOpts, type MapOpts } from '../../components/MapPanel/MapPanel';
import { applyRemoteSortPref, getSortPref, isSortPref } from '../sortPref';

/** How the sync engine reads and writes one preference. */
export type Adapter = {
  get(): unknown;
  /** only ever called with a value that passed `valid` (the cloud is not trusted) */
  apply(value: unknown): void;
  valid(value: unknown): boolean;
};

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

// ───────── settings: { view: { search: boolean, … } } ─────────
const VIEW_KEYS = Object.keys(DEFAULT_SETTINGS.view) as (keyof AppSettings['view'])[];
const cleanSettings = (v: unknown): AppSettings => {
  const view = isObject(v) && isObject(v.view) ? v.view : {};
  return {
    view: Object.fromEntries(
      VIEW_KEYS.map((k) => [k, isBool(view[k]) ? view[k] : DEFAULT_SETTINGS.view[k]]),
    ) as AppSettings['view'],
  };
};

// ───────── map options (everything except the basemap, which follows the satellite default) ─────────
const COLORS = ['route', 'speed', 'altitude'];
const POINTS = ['off', 'auto', 'all'];
const cleanMapOpts = (v: Record<string, unknown>): Partial<MapOpts> => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_OPTS) as (keyof MapOpts)[]) {
    if (k === 'base' || !(k in v)) continue;
    const ok =
      k === 'color' ? COLORS.includes(v[k] as string)
      : k === 'points' ? POINTS.includes(v[k] as string)
      : isBool(v[k]);
    if (ok) out[k] = v[k];
  }
  return out as Partial<MapOpts>;
};

/** "the example project is switched on": the app decides how to add / remove its clips (see useSync) */
let exampleHandler: ((on: boolean) => void) | null = null;
export const setExampleEnabledHandler = (fn: ((on: boolean) => void) | null) => {
  exampleHandler = fn;
};

export const prefAdapters: Record<SyncField, Adapter> = {
  settings: {
    get: () => getSettings(),
    apply: (v) => applyRemoteSettings(cleanSettings(v)),
    valid: (v) => isObject(v) && isObject(v.view),
  },
  satellite: { get: satelliteDefault, apply: (v) => applyRemoteSatelliteDefault(v as boolean), valid: isBool },
  projectMode: { get: getProjectMode, apply: (v) => applyRemoteProjectMode(v as boolean), valid: isBool },
  exampleEnabled: {
    get: () => exampleState().enabled,
    apply: (v) => (exampleHandler ?? applyRemoteExampleEnabled)(v as boolean),
    valid: isBool,
  },
  playbackHelp: {
    get: playbackHelpDismissed,
    apply: (v) => applyRemotePlaybackHelpDismissed(v as boolean),
    valid: isBool,
  },
  mapOpts: {
    get: () => {
      const opts: Partial<MapOpts> = { ...loadOpts() };
      delete opts.base; // the basemap follows each device's satellite default
      return opts;
    },
    apply: (v) => applyRemoteMapOpts(cleanMapOpts(v as Record<string, unknown>)),
    valid: isObject,
  },
  sort: { get: getSortPref, apply: (v) => applyRemoteSortPref(v as never), valid: isSortPref },
};
