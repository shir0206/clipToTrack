import type { Firestore } from 'firebase/firestore';
import { getFirebaseApp, shouldUseEmulators } from './app';

let db: Promise<Firestore> | null = null;

/**
 * Firestore with an on-disk cache: the app reads from it first (instant, works offline), writes made offline are
 * kept and sent later, and a restart only downloads what changed. Loaded lazily, like the rest of Firebase.
 */
export function getDb(): Promise<Firestore> {
  db ??= (async () => {
    const [app, fs] = await Promise.all([
      getFirebaseApp(),
      import('firebase/firestore'),
    ]);
    let d: Firestore;
    try {
      d = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({
          tabManager: fs.persistentMultipleTabManager(),
        }),
      });
    } catch {
      d = fs.getFirestore(app); // already started
    }
    if (shouldUseEmulators()) {
      try {
        fs.connectFirestoreEmulator(d, '127.0.0.1', 8080);
      } catch {
        /* already connected */
      }
    }
    return d;
  })();
  return db;
}
