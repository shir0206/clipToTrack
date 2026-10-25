import type { CloudPrefs, Options, PrefsBackend } from '../lib/sync/prefSync';
import { createPrefSync } from '../lib/sync/prefSync';
import { PREF_KEY, type SyncField } from '../lib/sync/syncKeys';
import type { Adapter } from '../lib/sync/prefAdapters';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
export const FIELDS = Object.keys(PREF_KEY) as SyncField[];

/**
 * One account's cloud, in memory: a prefs document, the kill switch, and an on/off line. Writes made while
 * "offline" are kept by the device (like Firestore's cache) and reach the cloud when the line comes back.
 */
export function fakeCloud(initial: CloudPrefs | null = null) {
  let doc: CloudPrefs | null = clone(initial);
  let enabled = true;
  let online = true;
  const prefsWatchers = new Set<(d: CloudPrefs | null) => void>();
  const enabledWatchers = new Set<(e: boolean) => void>();
  const held: { patch: CloudPrefs; done: () => void }[] = [];
  const log = { writes: [] as CloudPrefs[], prefsListens: 0, enabledListens: 0 };

  const tellAll = () => prefsWatchers.forEach((w) => w(clone(doc)));
  const merge = (patch: CloudPrefs) => {
    doc = { ...(doc ?? {}), ...clone(patch) };
  };

  const backend = (opts: { failWrites?: () => boolean } = {}): PrefsBackend => ({
    watchPrefs(cb) {
      log.prefsListens++;
      prefsWatchers.add(cb);
      queueMicrotask(() => online && prefsWatchers.has(cb) && cb(clone(doc)));
      return () => prefsWatchers.delete(cb);
    },
    watchEnabled(cb) {
      log.enabledListens++;
      enabledWatchers.add(cb);
      queueMicrotask(() => enabledWatchers.has(cb) && cb(enabled));
      return () => enabledWatchers.delete(cb);
    },
    write(patch) {
      log.writes.push(clone(patch));
      if (opts.failWrites?.()) return Promise.reject(new Error('permission-denied'));
      if (!online) return new Promise<void>((done) => held.push({ patch, done }));
      merge(patch);
      tellAll();
      return Promise.resolve();
    },
  });

  return {
    backend,
    log,
    get doc() {
      return clone(doc);
    },
    setEnabled(e: boolean) {
      enabled = e;
      enabledWatchers.forEach((w) => w(e));
    },
    goOffline() {
      online = false;
    },
    goOnline() {
      online = true;
      for (const h of held.splice(0)) {
        merge(h.patch);
        h.done();
      }
      tellAll();
    },
    /** another client changed the document directly */
    external(patch: CloudPrefs) {
      merge(patch);
      tellAll();
    },
  };
}

/** One device: its own values, its own change bus, its own bookkeeping storage, one sync engine. */
export function device(
  cloud: ReturnType<typeof fakeCloud>,
  init: Partial<Record<SyncField, unknown>> = {},
  o: { now?: () => number; backendOpts?: Parameters<ReturnType<typeof fakeCloud>['backend']>[0]; echoOnApply?: boolean; storage?: Map<string, string> } = {},
) {
  const values: Record<string, unknown> = { ...init };
  const subs = new Set<(f: SyncField) => void>();
  const emit = (f: SyncField) => subs.forEach((s) => s(f));
  const applied: [SyncField, unknown][] = [];
  const store = o.storage ?? new Map<string, string>();

  const adapters = Object.fromEntries(
    FIELDS.map((f): [SyncField, Adapter] => [
      f,
      {
        get: () => clone(values[f]),
        apply: (v) => {
          applied.push([f, clone(v)]);
          values[f] = clone(v);
          // some stores re-save what they just applied (the map does, from an effect): it must not echo
          if (o.echoOnApply) queueMicrotask(() => emit(f));
        },
        valid: (v) => v !== null && v !== undefined,
      },
    ]),
  ) as Record<SyncField, Adapter>;

  const options: Options = {
    adapters,
    loadBackend: async () => cloud.backend(o.backendOpts),
    onLocal: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    now: o.now,
    flushMs: 1500,
  };
  const engine = createPrefSync(options);
  const stop = engine.trackLocal();

  return {
    engine,
    adapters,
    values,
    applied,
    store,
    stop,
    /** the person changes a preference on this device */
    person(f: SyncField, v: unknown) {
      values[f] = clone(v);
      emit(f);
    },
  };
}

/** let queued microtasks run (snapshots, resolved writes) */
export const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
