/**
 * Registry of every localStorage key the app owns and what cloud sync does with it.
 * One place, so "does this follow the person to another device?" is never decided ad hoc.
 *
 *   pref    small preference; synced field by field (users/{uid}/prefs/main)
 *   data    clips / projects / place names; synced per document (Phase 4)
 *   partial only part of the value is synced (see `note`)
 *   device  stays on this device (a phone and a desktop want different values)
 *   meta    sync bookkeeping of this device; never synced, but wiped with the data it describes
 *   removed no longer used; safe to delete
 */
const P = 'clip-to-track:';

/** Names of the small synced preferences. Used by the change bus and by the cloud prefs doc. */
export type SyncField =
  | 'settings'
  | 'satellite'
  | 'projectMode'
  | 'exampleEnabled'
  | 'playbackHelp'
  | 'mapOpts'
  | 'sort';

export type KeyScope = 'pref' | 'data' | 'partial' | 'device' | 'meta' | 'removed';

type Entry = { scope: KeyScope; field?: SyncField; note?: string };

export const KEY_REGISTRY: Record<string, Entry> = {
  // ── synced preferences ──
  [`${P}settings:v1`]: { scope: 'pref', field: 'settings' },
  [`${P}satellite-default:v1`]: { scope: 'pref', field: 'satellite' },
  [`${P}project-mode:v1`]: { scope: 'pref', field: 'projectMode' },
  [`${P}playback-help-dismissed`]: { scope: 'pref', field: 'playbackHelp' },
  [`${P}map-opts:v4`]: {
    scope: 'pref',
    field: 'mapOpts',
    note: 'basemap is not stored here (it follows the satellite default)',
  },
  [`${P}sort`]: { scope: 'pref', field: 'sort' },

  // ── synced data (Phase 4) ──
  [`${P}clips:v1`]: { scope: 'data', note: 'example clips are never synced' },
  [`${P}projects:v1`]: {
    scope: 'data',
    note: 'the example project is never synced; membership is derived from clips',
  },
  [`${P}clip-places:v1`]: { scope: 'data', note: 'travels inside the clip doc' },

  // ── partly synced ──
  [`${P}example`]: {
    scope: 'partial',
    field: 'exampleEnabled',
    note: 'only `enabled` is synced; projectId, clipIds and videos are per device',
  },

  // ── per device ──
  [`${P}sheet-snap`]: { scope: 'device' },
  [`${P}force-layout`]: { scope: 'device' },
  [`${P}panel-width`]: { scope: 'device' },
  [`${P}profile-height`]: { scope: 'device' },

  // ── sync bookkeeping (when this device changed what, which accounts it has met) ──
  [`${P}sync-meta:v1`]: {
    scope: 'meta',
    note: 'wiped on sign-out: after a wipe the defaults must not look like fresh edits',
  },

  // ── retired ──
  [`${P}example-upload-auto:v1`]: {
    scope: 'removed',
    note: 'the "where should videos go?" dialog no longer exists',
  },
};

export const scopeOf = (key: string): KeyScope | undefined =>
  KEY_REGISTRY[key]?.scope;

/** true when any part of the key's value follows the person to other devices */
export const isSyncedKey = (key: string): boolean => {
  const s = scopeOf(key);
  return s === 'pref' || s === 'data' || s === 'partial';
};

/** keys of the small synced preferences, by field */
export const PREF_KEY: Record<SyncField, string> = Object.fromEntries(
  Object.entries(KEY_REGISTRY)
    .filter(([, e]) => e.field)
    .map(([k, e]) => [e.field!, k]),
) as Record<SyncField, string>;
