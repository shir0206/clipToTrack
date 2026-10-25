import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon/Icon';
import { signOutUser } from '../../lib/firebase/auth';
import { CLOUD_SYNC_ACTIVE } from '../../lib/sync/flags';
import { wipeThenReload } from '../../lib/sync/wipeLocal';
import '../playback/PlaybackHelp.css'; // the dialog look (.help-*) is shared with the other small dialogs
import './Account.css';

type Props = {
  onClose: () => void;
  /** a video is still being added: signing out must wait */
  uploading?: boolean;
  /**
   * Offer "remove my clips from this device". Only makes sense once the data is safe in the cloud, so it follows
   * CLOUD_SYNC_ACTIVE; without it signing out never touches this device's data.
   */
  wipeAvailable?: boolean;
  reload?: () => void;
};

export default function SignOutDialog({
  onClose,
  uploading = false,
  wipeAvailable = CLOUD_SYNC_ACTIVE,
  reload,
}: Props) {
  // shared computers: removing the data is the safe default
  const [wipe, setWipe] = useState(true);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirm.current?.focus();
  }, []);

  const go = async () => {
    setWorking(true);
    setFailed(false);
    const ok = await signOutUser();
    if (!ok) {
      setWorking(false);
      setFailed(true);
      return; // still signed in: nothing is removed
    }
    if (wipeAvailable && wipe) wipeThenReload(reload);
    else onClose();
  };

  return (
    <div
      className="help-backdrop"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation(); // don't also close the Settings dialog underneath
        if (!working) onClose();
      }}
    >
      <div
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ctt-so-title"
      >
        <header className="help-header">
          <Icon name="info" size={18} />
          <h2 className="help-title" id="ctt-so-title">
            Sign out?
          </h2>
        </header>

        {wipeAvailable ? (
          <>
            <p className="help-text">
              Your clips and settings stay in your account and come back when
              you sign in again.
            </p>
            <fieldset className="account-choices">
              <legend className="visually-hidden">This device</legend>
              <label className="help-option">
                <input
                  type="radio"
                  name="so"
                  checked={wipe}
                  onChange={() => setWipe(true)}
                />
                Remove my clips from this device{' '}
                <small>(best on a shared computer)</small>
              </label>
              <label className="help-option">
                <input
                  type="radio"
                  name="so"
                  checked={!wipe}
                  onChange={() => setWipe(false)}
                />
                Keep a copy on this device
              </label>
            </fieldset>
          </>
        ) : (
          <p className="help-text">
            Your clips and settings stay on this device.
          </p>
        )}

        {uploading && (
          <p className="help-alternate" role="note">
            A video is still being added. Wait for it to finish before signing
            out.
          </p>
        )}
        {failed && (
          <p className="help-alternate" role="alert">
            Couldn’t sign out. Please try again.
          </p>
        )}

        <footer className="help-footer">
          <button className="link-button" disabled={working} onClick={onClose}>
            Cancel
          </button>
          <button
            ref={confirm}
            className="help-confirm"
            disabled={uploading || working}
            onClick={() => void go()}
          >
            Sign out
          </button>
        </footer>
      </div>
    </div>
  );
}
