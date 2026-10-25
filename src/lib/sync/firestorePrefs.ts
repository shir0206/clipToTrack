import type { CloudPrefs, PrefsBackend } from './prefSync';
import { PREF_KEY, type SyncField } from './syncKeys';

const FIELDS = Object.keys(PREF_KEY) as SyncField[];

/** Only entries shaped { v, t: number } for fields this version knows. (The engine checks the values themselves.) */
const parse = (f: unknown): CloudPrefs => {
  const out: CloudPrefs = {};
  if (!f || typeof f !== 'object') return out;
  for (const k of FIELDS) {
    const e = (f as Record<string, unknown>)[k] as { v?: unknown; t?: unknown } | undefined;
    if (e && typeof e.t === 'number') out[k] = { v: e.v, t: e.t };
  }
  return out;
};

/**
 * Preferences of one person: users/{uid}/prefs/main  →  { f: { <field>: { v, t } }, updatedAt }
 * and the kill switch: config/global  →  { cloudEnabled }.   Firebase is imported lazily.
 */
export async function createFirestorePrefsBackend(uid: string): Promise<PrefsBackend> {
  const [{ getDb }, fs] = await Promise.all([import('../firebase/firestore'), import('firebase/firestore')]);
  const db = await getDb();
  const prefs = fs.doc(db, 'users', uid, 'prefs', 'main');
  const global = fs.doc(db, 'config', 'global');

  return {
    watchPrefs: (onData, onError) =>
      fs.onSnapshot(prefs, (snap) => onData(snap.exists() ? parse(snap.data()?.f) : null), onError),

    // a missing document, or one we cannot read, means "enabled": the switch only ever turns sync OFF
    watchEnabled: (onValue) =>
      fs.onSnapshot(
        global,
        (snap) => onValue(snap.exists() ? snap.data()?.cloudEnabled !== false : true),
        () => onValue(true),
      ),

    // mergeFields replaces exactly the listed fields (a settings object is replaced, not merged key by key)
    write: (patch) =>
      fs.setDoc(
        prefs,
        { f: patch, updatedAt: fs.serverTimestamp() },
        { mergeFields: [...Object.keys(patch).map((k) => `f.${k}`), 'updatedAt'] },
      ),
  };
}
