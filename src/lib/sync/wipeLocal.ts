import { KEY_REGISTRY } from './syncKeys';

/**
 * Removes this person's synced data from the browser: preferences and clip / project data.
 * Kept on purpose: per-device layout state, the example project's own bookkeeping (it re-installs itself), and
 * any key this app does not own.
 * Returns the keys it removed.
 */
export function wipeSyncedLocalData(): string[] {
  const removed: string[] = [];
  for (const [key, entry] of Object.entries(KEY_REGISTRY)) {
    if (entry.scope !== 'pref' && entry.scope !== 'data') continue;
    try {
      if (localStorage.getItem(key) !== null) removed.push(key);
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/**
 * Wipe, then reload so every in-memory store starts from the empty state. The wipe runs a second time as the
 * page unloads: a late effect (a place-name lookup finishing, say) must not write the old data back.
 */
export function wipeThenReload(
  reload: () => void = () => window.location.reload(),
) {
  wipeSyncedLocalData();
  window.addEventListener('pagehide', wipeSyncedLocalData, { once: true });
  reload();
}
