import { useEffect, useState } from 'react';
import { clearAuthError, signInWithGoogle, useAuth } from '../../lib/firebase/auth';
import { CLOUD_SYNC_ACTIVE, PREFS_SYNC_ACTIVE } from '../../lib/sync/flags';
import { useSyncStatus } from '../../lib/sync/prefSync';
import SignOutDialog from './SignOutDialog';
import './Account.css';

function hint(signedIn: boolean, sync: ReturnType<typeof useSyncStatus>): string {
  if (!signedIn)
    return CLOUD_SYNC_ACTIVE
      ? 'Keep your clips and settings on all your devices. Without an account everything stays on this device.'
      : PREFS_SYNC_ACTIVE
        ? 'Keep your settings on all your devices. Your clips stay on this device.'
        : 'Everything stays on this device.';
  if (!PREFS_SYNC_ACTIVE) return 'Signed in. Everything is still stored on this device.';
  if (sync === 'paused') return 'Cloud sync is paused for now. Your changes are kept on this device.';
  if (sync === 'error') return 'Couldn’t reach your account just now. Your changes are kept on this device and will be sent when you change something.';
  return CLOUD_SYNC_ACTIVE
    ? 'Your clips and settings are saved to your account.'
    : 'Your settings are saved to your account. Your clips stay on this device.';
}

/** The "Account" block of the Settings dialog. Renders nothing when accounts are not configured. */
export default function AccountSection({ uploading = false }: { uploading?: boolean }) {
  const auth = useAuth();
  const sync = useSyncStatus();
  const [asking, setAsking] = useState(false);
  useEffect(() => () => clearAuthError(), []);

  if (!auth.available || auth.status === 'loading') return null;
  const signedIn = auth.status === 'user';

  return (
    <section className="settings-section" aria-labelledby="set-account">
      <h3 className="settings-title" id="set-account">
        Account
      </h3>
      <div className="settings-row">
        <span>
          <b className="settings-label">{signedIn ? (auth.user?.email ?? 'Signed in') : 'Sign in with Google'}</b>
          <small className="settings-hint">
            {hint(signedIn, sync)}
          </small>
          {auth.error && (
            <small className="settings-warning" role="alert">
              {auth.error}
            </small>
          )}
        </span>
        {signedIn ? (
          <button className="link-button" onClick={() => setAsking(true)}>
            Sign out…
          </button>
        ) : (
          <button className="link-button" disabled={auth.signingIn} onClick={() => void signInWithGoogle()}>
            Sign in
          </button>
        )}
      </div>
      {asking && <SignOutDialog uploading={uploading} onClose={() => setAsking(false)} />}
    </section>
  );
}
