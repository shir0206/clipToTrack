import type { AuthBackend } from './auth';
import { getFirebaseApp, shouldUseEmulators } from './app';

/**
 * The real Firebase Auth behind the AuthBackend interface (see auth.ts). Everything from `firebase/*`
 * is imported lazily, so this file costs guests nothing.
 */
export async function loadFirebaseBackend(): Promise<AuthBackend> {
  const [app, fb] = await Promise.all([
    getFirebaseApp(),
    import('firebase/auth'),
  ]);
  const auth = fb.getAuth(app);
  if (shouldUseEmulators())
    fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });

  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' }); // let people with several Google accounts choose

  return {
    onChange: (cb, onError) =>
      fb.onAuthStateChanged(
        auth,
        (u) =>
          cb(
            u && {
              uid: u.uid,
              email: u.email,
              name: u.displayName,
              photoURL: u.photoURL,
            },
          ),
        onError,
      ),
    consumeRedirectResult: async () => {
      await fb.getRedirectResult(auth);
    },
    popup: async () => {
      await fb.signInWithPopup(auth, provider);
    },
    redirect: () => fb.signInWithRedirect(auth, provider),
    signOut: () => fb.signOut(auth),
  };
}
