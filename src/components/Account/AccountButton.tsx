import { useEffect, useRef, useState } from 'react';
import {
  clearAuthError,
  signInWithGoogle,
  useAuth,
  type AuthUser,
} from '../../lib/firebase/auth';
import SignOutDialog from './SignOutDialog';
import './Account.css';

type Props = {
  /** phone header: no room for a "Sign in" button there (guests sign in from Settings), only the avatar */
  compact?: boolean;
  uploading?: boolean;
};

const initialOf = (u: AuthUser) =>
  (u.name || u.email || '?').trim().charAt(0).toUpperCase();

/** Header control: "Sign in" for guests, the avatar with a small menu for a signed-in person. */
export default function AccountButton({
  compact = false,
  uploading = false,
}: Props) {
  const auth = useAuth();
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);
  // an old error must not be waiting when this control is used again later
  useEffect(() => () => clearAuthError(), []);

  if (!auth.available || auth.status === 'loading') return null; // no flicker while a saved session is restored

  if (auth.status === 'guest')
    return compact ? null : (
      <div className="account" ref={root}>
        <button
          className="account-signin"
          disabled={auth.signingIn}
          onClick={() => void signInWithGoogle()}
        >
          Sign in
        </button>
        {auth.error && (
          <p className="account-error" role="alert">
            {auth.error}
          </p>
        )}
      </div>
    );

  const u = auth.user!;
  return (
    <div className="account" ref={root}>
      <button
        className="account-avatar"
        aria-label={`Account: ${u.email ?? u.name ?? 'signed in'}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
      >
        {u.photoURL ? (
          <img src={u.photoURL} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden="true">{initialOf(u)}</span>
        )}
      </button>
      {menu && (
        <div className="account-menu" role="menu">
          <p className="account-who">
            {u.name && <b>{u.name}</b>}
            <span>{u.email}</span>
          </p>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setAsking(true);
            }}
          >
            Sign out…
          </button>
        </div>
      )}
      {auth.error && (
        <p className="account-error" role="alert">
          {auth.error}
        </p>
      )}
      {asking && (
        <SignOutDialog uploading={uploading} onClose={() => setAsking(false)} />
      )}
    </div>
  );
}
