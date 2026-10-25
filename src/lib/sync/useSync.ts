import { useEffect, useRef } from 'react';
import { useAuth } from '../firebase/auth';
import { PREFS_SYNC_ACTIVE } from './flags';
import { applyRemoteExampleEnabled } from '../../components/ExampleProject/exampleProject';
import { setExampleEnabledHandler } from './prefAdapters';
import { prefSync, useSyncStatus, type SyncStatus } from './prefSync';

type Args = {
  /**
   * What to do when the account says the example project is switched on / off. Pass useExampleProject's
   * `setEnabled`: it adds or removes the example clips (a bare flag change would leave them behind).
   */
  onExampleEnabled?: (on: boolean) => void;
};

/**
 * Mount once, in the App. Always timestamps the person's changes (a guest's too, so that signing in later knows
 * which choices are theirs); while signed in, keeps the preferences in step with the account.
 */
export function useSync({ onExampleEnabled }: Args = {}): SyncStatus {
  const auth = useAuth();
  const latest = useRef(onExampleEnabled);
  useEffect(() => {
    latest.current = onExampleEnabled;
  });

  useEffect(() => {
    setExampleEnabledHandler((on) => (latest.current ?? applyRemoteExampleEnabled)(on));
    return () => setExampleEnabledHandler(null);
  }, []);

  useEffect(() => prefSync.trackLocal(), []);

  const uid = PREFS_SYNC_ACTIVE && auth.status === 'user' ? auth.user!.uid : null;
  useEffect(() => {
    if (!uid) return;
    void prefSync.connect(uid);
    return () => prefSync.disconnect();
  }, [uid]);

  // a change made a moment ago must leave before the tab goes away
  useEffect(() => {
    const out = () => document.visibilityState === 'hidden' && void prefSync.flush();
    document.addEventListener('visibilitychange', out);
    return () => document.removeEventListener('visibilitychange', out);
  }, []);

  return useSyncStatus();
}
