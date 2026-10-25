import type { FirebaseApp } from 'firebase/app';

/**
 * Firebase web config, from Vite env vars (see .env.example). These values are public identifiers, not
 * secrets (access is controlled by Auth + Firestore rules), but they differ per project, so they live in env.
 *
 * With any of them missing the whole account feature switches itself off: the app runs exactly as a guest app.
 */
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = (): boolean =>
  !!(config.apiKey && config.authDomain && config.projectId && config.appId);

/** Dev only: talk to the local Firebase emulators instead of the real project (VITE_USE_FIREBASE_EMULATORS=1) */
export const shouldUseEmulators = (): boolean =>
  env.VITE_USE_FIREBASE_EMULATORS === '1';

let app: Promise<FirebaseApp> | null = null;

/** The Firebase app, created on first use. Loaded lazily so guests never download the Firebase code. */
export function getFirebaseApp(): Promise<FirebaseApp> {
  app ??= import('firebase/app').then(({ initializeApp, getApps }) =>
    getApps().length ? getApps()[0] : initializeApp(config),
  );
  return app;
}
