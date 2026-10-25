import { useEffect, useState } from 'react';
import {
  clearAuthError,
  signInWithGoogle,
  useAuth,
} from '../../lib/firebase/auth';
import { CLOUD_SYNC_ACTIVE } from '../../lib/sync/flags';
import SignOutDialog from './SignOutDialog';
import './Account.css';

/** The "Account" block of the Settings dialog. Renders nothing when accounts are not configured. */
export default function AccountSection({
  uploading = false,
}: {
  uploading?: boolean;
}) {
  const auth = useAuth();
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
          <b className="settings-label">
            {signedIn
              ? (auth.user?.email ?? 'Signed in')
              : 'Sign in with Google'}
          </b>
          <small className="settings-hint">
            {signedIn
              ? CLOUD_SYNC_ACTIVE
                ? 'Your clips and settings are saved to your account.'
                : 'Signed in. Syncing between devices is not switched on yet: everything is still stored on this device.'
              : CLOUD_SYNC_ACTIVE
                ? 'Keep your clips and settings on all your devices. Without an account everything stays on this device.'
                : 'Everything stays on this device. Signing in is the first step towards syncing between devices.'}
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
          <button
            className="link-button"
            disabled={auth.signingIn}
            onClick={() => void signInWithGoogle()}
          >
            Sign in
          </button>
        )}
      </div>
      {asking && (
        <SignOutDialog uploading={uploading} onClose={() => setAsking(false)} />
      )}
    </section>
  );
}
