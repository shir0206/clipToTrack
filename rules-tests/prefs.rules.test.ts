import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

/**
 * Run with:  firebase emulators:exec --only firestore "vitest run --config vitest.rules.config.ts"
 * (package.json:  "test:rules": that command)
 */
let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-clip-to-track',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const anon = () => env.unauthenticatedContext().firestore();
const prefs = (db: ReturnType<typeof alice>, uid = 'alice') => doc(db, 'users', uid, 'prefs', 'main');
const valid = () => ({ f: { satellite: { v: false, t: 5 }, sort: { v: { key: 'name', dir: 1 }, t: 6 } }, updatedAt: serverTimestamp() });

describe('users/{uid}/prefs/main', () => {
  it('the owner can create, read, update and delete it', async () => {
    await assertSucceeds(setDoc(prefs(alice()), valid()));
    await assertSucceeds(getDoc(prefs(alice())));
    await assertSucceeds(setDoc(prefs(alice()), valid(), { mergeFields: ['f.satellite', 'updatedAt'] }));
    await assertSucceeds(deleteDoc(prefs(alice())));
  });

  it('another signed-in person can neither read nor write it', async () => {
    await assertSucceeds(setDoc(prefs(alice()), valid()));
    await assertFails(getDoc(prefs(bob(), 'alice')));
    await assertFails(setDoc(prefs(bob(), 'alice'), valid()));
    await assertFails(deleteDoc(prefs(bob(), 'alice')));
  });

  it('a signed-out visitor can neither read nor write it', async () => {
    await assertFails(getDoc(prefs(anon())));
    await assertFails(setDoc(prefs(anon()), valid()));
  });

  it('rejects an unknown preference field', async () => {
    await assertFails(setDoc(prefs(alice()), { f: { evil: { v: 1, t: 1 } }, updatedAt: serverTimestamp() }));
  });

  it('rejects an unknown top-level field', async () => {
    await assertFails(setDoc(prefs(alice()), { ...valid(), extra: 'x' }));
  });

  it('rejects `f` that is not a map, and an `updatedAt` that is not a timestamp', async () => {
    await assertFails(setDoc(prefs(alice()), { f: 'nope', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(prefs(alice()), { f: {}, updatedAt: 'yesterday' }));
  });
});

describe('config/global (the kill switch)', () => {
  it('anyone can read it, nobody can write it from the app', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'config', 'global')));
    await assertSucceeds(getDoc(doc(alice(), 'config', 'global')));
    await assertFails(setDoc(doc(alice(), 'config', 'global'), { cloudEnabled: false }));
    await assertFails(setDoc(doc(anon(), 'config', 'global'), { cloudEnabled: false }));
  });

  it('other documents in config are closed', async () => {
    await assertFails(getDoc(doc(alice(), 'config', 'secrets')));
  });
});

describe('everything else is closed', () => {
  it('own clips / projects are not open yet (Phase 4), and neither is anything made up', async () => {
    await assertFails(setDoc(doc(alice(), 'users', 'alice', 'clips', 'c1'), { x: 1 }));
    await assertFails(getDoc(doc(alice(), 'users', 'alice')));
    await assertFails(setDoc(doc(alice(), 'whatever', 'x'), { x: 1 }));
  });
});
