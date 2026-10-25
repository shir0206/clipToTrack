import { useEffect, useSyncExternalStore } from 'react';
import { isFirebaseConfigured } from './app';
import { loadFirebaseBackend } from './firebaseBackend';

export type AuthUser = {
  uid: string;
  email: string | null;
  name: string | null;
  photoURL: string | null;
};

/**
 *  loading  Firebase is restoring a saved session. The UI treats this like a guest (no flicker, nothing blocked).
 *  guest    not signed in (or accounts are not configured). The app works exactly as before.
 *  user     signed in with Google.
 */
export type AuthStatus = 'loading' | 'guest' | 'user';

export type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  /** a message for the person (already worded for them); null = nothing to show */
  error: string | null;
  /** false when the Firebase env vars are missing: hide every account control */
  available: boolean;
  /** a sign-in is in progress (popup open) */
  signingIn: boolean;
};

/** What the store needs from Firebase. The real one is firebaseBackend.ts; tests pass a fake. */
export type AuthBackend = {
  onChange(
    cb: (user: AuthUser | null) => void,
    onError: (e: unknown) => void,
  ): () => void;
  consumeRedirectResult(): Promise<void>;
  popup(): Promise<void>;
  redirect(): Promise<void>;
  signOut(): Promise<void>;
};

type Options = {
  available: boolean;
  load: () => Promise<AuthBackend>;
  /** e.g. an iOS home-screen app, where popups do not work */
  redirectPreferred?: () => boolean;
};

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code ?? '';

/** The person closed the window themselves: not an error worth showing. */
const SILENT = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);
/** The browser refused the popup: try the full-page redirect instead. */
const USE_REDIRECT = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
]);

/** Words for the person. Never shows raw Firebase codes. null = say nothing. */
export function describeAuthError(e: unknown): string | null {
  const code = codeOf(e);
  if (SILENT.has(code)) return null;
  if (code === 'auth/network-request-failed')
    return "Couldn't reach Google. Check your connection and try again.";
  if (code === 'auth/unauthorized-domain')
    return "Sign-in isn't set up for this address yet.";
  if (code === 'auth/user-disabled') return 'This account has been disabled.';
  return 'Sign-in failed. Please try again.';
}

export function createAuthStore(opts: Options) {
  let state: AuthState = {
    status: opts.available ? 'loading' : 'guest',
    user: null,
    error: null,
    available: opts.available,
    signingIn: false,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<AuthState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  let backend: AuthBackend | null = null;
  let starting: Promise<AuthBackend | null> | null = null;

  /** Loads Firebase once and starts listening. A failure is silent (offline guests are fine) and can be retried. */
  const init = (): Promise<AuthBackend | null> => {
    if (!opts.available) return Promise.resolve(null);
    starting ??= opts
      .load()
      .then((b) => {
        backend = b;
        b.onChange(
          (user) => set({ status: user ? 'user' : 'guest', user }),
          () => set({ status: 'guest', user: null }),
        );
        // back from a full-page sign-in: finish it; a failure is shown like any other
        b.consumeRedirectResult().catch((e) =>
          set({ error: describeAuthError(e) }),
        );
        return b;
      })
      .catch(() => {
        starting = null; // try again on the next click
        set({ status: 'guest', user: null });
        return null;
      });
    return starting;
  };

  /** Must be called straight from a click: the popup only opens inside the click's own tick. */
  const signIn = async () => {
    if (!opts.available || state.signingIn) return;
    set({ error: null, signingIn: true });
    try {
      // when Firebase is already loaded there is no await before the popup, so the click still counts
      const b = backend ?? (await init());
      if (!b)
        throw Object.assign(new Error('offline'), {
          code: 'auth/network-request-failed',
        });
      if (opts.redirectPreferred?.()) {
        await b.redirect();
        return;
      }
      try {
        await b.popup();
      } catch (e) {
        if (!USE_REDIRECT.has(codeOf(e))) throw e;
        await b.redirect();
      }
    } catch (e) {
      set({ error: describeAuthError(e) });
    } finally {
      set({ signingIn: false });
    }
  };

  /** true = signed out */
  const signOut = async (): Promise<boolean> => {
    try {
      await backend?.signOut();
      return true;
    } catch {
      set({ error: "Couldn't sign out. Please try again." });
      return false;
    }
  };

  return {
    getState: () => state,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    init,
    signIn,
    signOut,
    clearError: () => {
      if (state.error) set({ error: null });
    },
  };
}

// ───────── the app's one store ─────────
const store = createAuthStore({
  available: isFirebaseConfigured(),
  load: loadFirebaseBackend,
  redirectPreferred: () =>
    (navigator as Navigator & { standalone?: boolean }).standalone === true, // iOS home-screen app
});

/** Auth state for any component. Mounting the first one restores a saved session. */
export function useAuth(): AuthState {
  useEffect(() => {
    void store.init();
  }, []);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
export const signInWithGoogle = store.signIn;
export const signOutUser = store.signOut;
export const clearAuthError = store.clearError;
