import { useSyncExternalStore } from 'react';
import { onLocalChange } from './changeBus';
import { PREF_KEY, type SyncField } from './syncKeys';
import { prefAdapters, type Adapter } from './prefAdapters';

/**
 * Keeps the small synced preferences (settings, map options, sort order…) in step with
 * users/{uid}/prefs/main, one field at a time.
 *
 * WHO WINS (each field has a value `v` and the time `t` the person changed it):
 *  - first time this device meets this account: the cloud wins for every field it has (a stranger's defaults, or
 *    a guest's old choices, must not overwrite the account); local choices fill the fields the cloud lacks
 *  - afterwards: the newer `t` wins, a tie goes to the cloud
 *  - a change made here is sent after a short pause, only the fields that changed
 *  - a value that came from the cloud is never sent back, and a "change" to a value the cloud already has is
 *    ignored (a map that re-saves what it just applied must not look like a new edit)
 * Clocks of different devices are trusted as they are: a device whose clock is far off can win wrongly.
 */
export type CloudField = { v: unknown; t: number };
export type CloudPrefs = Partial<Record<SyncField, CloudField>>;

/** The cloud side. The real one is firestorePrefs.ts; tests pass a fake. */
export interface PrefsBackend {
  /** null = the document does not exist yet */
  watchPrefs(onData: (fields: CloudPrefs | null) => void, onError: (e: unknown) => void): () => void;
  /** the kill switch (config/global.cloudEnabled); a missing document means enabled */
  watchEnabled(onValue: (enabled: boolean) => void): () => void;
  write(patch: CloudPrefs): Promise<void>;
}

export type SyncStatus =
  | 'off' // not signed in, or sync not switched on
  | 'connecting'
  | 'live'
  | 'paused' // the kill switch is on
  | 'error';

type Meta = { t: Partial<Record<SyncField, number>>; linked: string[] };
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export type Options = {
  adapters: Record<SyncField, Adapter>;
  loadBackend: (uid: string) => Promise<PrefsBackend>;
  /** how this device hears about changes the person makes (default: the shared change bus) */
  onLocal?: (cb: (field: SyncField) => void) => () => void;
  storage?: Store;
  now?: () => number;
  /** pause before a change is sent, so ten quick toggles make one write */
  flushMs?: number;
};

export const META_KEY = 'clip-to-track:sync-meta:v1';

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
        )
      : v;
/** the same text for equal values, whatever the key order */
export const stable = (v: unknown) => JSON.stringify(sortKeys(v));
/** plain JSON only (Firestore rejects `undefined`) */
const clean = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

const FIELDS = Object.keys(PREF_KEY) as SyncField[];

export function createPrefSync(o: Options) {
  const adapters = o.adapters;
  const now = o.now ?? Date.now;
  const flushMs = o.flushMs ?? 1500;
  const storage: Store | undefined = o.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const listen = o.onLocal ?? onLocalChange;

  // ───────── this device's bookkeeping ─────────
  const loadMeta = (): Meta => {
    try {
      const m = JSON.parse(storage?.getItem(META_KEY) ?? '{}');
      return {
        t: m && typeof m.t === 'object' && m.t ? m.t : {},
        linked: Array.isArray(m?.linked) ? m.linked.filter((x: unknown) => typeof x === 'string') : [],
      };
    } catch {
      return { t: {}, linked: [] };
    }
  };
  let meta = loadMeta();
  const saveMeta = () => {
    try {
      storage?.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      /* ignore */
    }
  };

  // ───────── status ─────────
  let status: SyncStatus = 'off';
  const listeners = new Set<() => void>();
  const setStatus = (s: SyncStatus) => {
    if (s === status) return;
    status = s;
    listeners.forEach((l) => l());
  };

  // ───────── connection state ─────────
  let uid: string | null = null;
  let backend: PrefsBackend | null = null;
  let generation = 0; // bumped on disconnect: late async results from an old connection are dropped
  let reconciled = false;
  let paused = false;
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> = Promise.resolve();
  let enabledOff: (() => void) | null = null;
  let prefsOff: (() => void) | null = null;
  const synced = new Map<SyncField, string>(); // last value known to be in the cloud (as `stable` text)
  const pending = new Set<SyncField>();

  const valid = (f: SyncField, c: CloudPrefs[SyncField]): c is CloudField =>
    !!c && typeof c.t === 'number' && Number.isFinite(c.t) && c.v !== undefined && adapters[f].valid(c.v);

  /** The cloud's value becomes ours. */
  const takeCloud = (f: SyncField, c: CloudField) => {
    synced.set(f, stable(c.v));
    meta.t[f] = c.t;
    if (stable(adapters[f].get()) === stable(c.v)) return;
    applying = true; // changes the store reports while we apply are not the person's
    try {
      adapters[f].apply(clean(c.v));
    } finally {
      applying = false;
    }
  };

  const send = (patch: CloudPrefs): Promise<void> => {
    if (!backend) return Promise.resolve();
    const b = backend;
    const gen = generation;
    for (const [f, c] of Object.entries(patch) as [SyncField, CloudField][]) synced.set(f, stable(c.v));
    const p = b
      .write(patch)
      .then(() => {
        if (gen === generation && status === 'error') setStatus('live');
      })
      .catch(() => {
        if (gen !== generation) return;
        // forget them, so the next change of those fields tries again
        for (const f of Object.keys(patch) as SyncField[]) synced.delete(f);
        setStatus('error');
      });
    inflight = p;
    return p;
  };

  const schedule = () => {
    timer ??= setTimeout(() => {
      timer = null;
      void flush();
    }, flushMs);
  };

  /** Sends what changed. Resolves when the write is done (or at once if there is nothing to send). */
  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!backend || !reconciled || paused || !pending.size) return inflight;
    const patch: CloudPrefs = {};
    for (const f of pending) {
      const v = clean(adapters[f].get());
      if (stable(v) !== synced.get(f)) patch[f] = { v, t: meta.t[f] ?? now() };
    }
    pending.clear();
    return Object.keys(patch).length ? send(patch) : inflight;
  };

  /** The person changed something on this device. */
  const localChanged = (f: SyncField) => {
    if (applying || !adapters[f]) return;
    const cur = stable(adapters[f].get());
    if (synced.get(f) === cur) return; // the cloud already has exactly this: nothing to record or send
    meta.t[f] = now();
    saveMeta();
    if (reconciled && !paused) {
      pending.add(f);
      schedule();
    }
  };

  /** First snapshot of a connection: decide field by field. */
  const reconcile = (data: CloudPrefs | null) => {
    const wasLinked = !!uid && meta.linked.includes(uid);
    const patch: CloudPrefs = {};
    for (const f of FIELDS) {
      const c = valid(f, data?.[f]) ? data![f]! : undefined;
      const lt = meta.t[f];
      if (c && (!wasLinked || lt === undefined || c.t >= lt)) {
        takeCloud(f, c); // first meeting, no local choice, or the cloud is at least as new
      } else if (c) {
        // we changed it more recently than the cloud has it
        if (stable(adapters[f].get()) === stable(c.v)) synced.set(f, stable(c.v));
        else patch[f] = { v: clean(adapters[f].get()), t: lt! };
      } else if (lt !== undefined) {
        patch[f] = { v: clean(adapters[f].get()), t: lt }; // the cloud lacks it: fill it from here
      }
    }
    if (uid && !wasLinked) meta.linked = [...meta.linked, uid];
    saveMeta();
    reconciled = true;
    if (Object.keys(patch).length) void send(patch);
  };

  /** Later snapshots: only real changes made elsewhere. */
  const follow = (data: CloudPrefs | null) => {
    if (!data) return;
    for (const f of FIELDS) {
      const c = valid(f, data[f]) ? data[f]! : undefined;
      if (!c || stable(c.v) === synced.get(f)) continue; // ours coming back, or unchanged
      if (c.t > (meta.t[f] ?? 0)) takeCloud(f, c); // an older value does not beat what we changed
    }
  };

  const startPrefs = (gen: number) => {
    if (prefsOff || !backend) return;
    prefsOff = backend.watchPrefs(
      (data) => {
        if (gen !== generation) return;
        if (!reconciled) reconcile(data);
        else follow(data);
        if (!paused) setStatus('live');
      },
      () => gen === generation && setStatus('error'),
    );
  };
  const stopPrefs = () => {
    prefsOff?.();
    prefsOff = null;
    reconciled = false;
    synced.clear();
    pending.clear();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // ───────── public ─────────
  const disconnect = () => {
    generation++;
    enabledOff?.();
    enabledOff = null;
    stopPrefs();
    backend = null;
    uid = null;
    paused = false;
    setStatus('off');
  };

  const connect = async (user: string) => {
    if (uid === user) return;
    disconnect();
    uid = user;
    const gen = generation;
    setStatus('connecting');
    let b: PrefsBackend;
    try {
      b = await o.loadBackend(user);
    } catch {
      if (gen === generation) setStatus('error');
      return;
    }
    if (gen !== generation) return;
    backend = b;
    // the kill switch decides whether the prefs document is read at all
    enabledOff = b.watchEnabled((enabled) => {
      if (gen !== generation) return;
      if (enabled) {
        paused = false;
        if (status === 'paused') setStatus('connecting');
        startPrefs(gen);
      } else {
        paused = true;
        stopPrefs();
        setStatus('paused');
      }
    });
  };

  return {
    /** start hearing about the person's changes (also as a guest: it timestamps them). Returns the stop function. */
    trackLocal: () => listen(localChanged),
    connect,
    disconnect,
    flush,
    getStatus: () => status,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

// ───────── the app's one engine ─────────
export const prefSync = createPrefSync({
  adapters: prefAdapters,
  loadBackend: (uid) => import('./firestorePrefs').then((m) => m.createFirestorePrefsBackend(uid)),
});

export const useSyncStatus = (): SyncStatus =>
  useSyncExternalStore(prefSync.subscribe, prefSync.getStatus, () => 'off');

/** Best effort, never longer than `ms`: lets a change made a moment ago leave before the person signs out. */
export const flushSync = (ms = 3000): Promise<void> =>
  Promise.race([prefSync.flush(), new Promise<void>((r) => setTimeout(r, ms))]);
