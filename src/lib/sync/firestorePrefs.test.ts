import { afterEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => {
  const handlers: Record<string, { ok: (s: unknown) => void; err: (e: unknown) => void }> = {};
  return {
    handlers,
    doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
    onSnapshot: vi.fn((ref: { path: string }, ok: (s: unknown) => void, err: (e: unknown) => void) => {
      handlers[ref.path] = { ok, err };
      return () => delete handlers[ref.path];
    }),
    setDoc: vi.fn(async () => {}),
    serverTimestamp: vi.fn(() => '<server time>'),
  };
});
vi.mock('firebase/firestore', () => fs);
vi.mock('../firebase/firestore', () => ({ getDb: async () => ({ db: true }) }));

import { createFirestorePrefsBackend } from './firestorePrefs';

afterEach(() => vi.clearAllMocks());
const snap = (data: unknown, exists = true) => ({ exists: () => exists, data: () => data });

describe('Firestore prefs backend', () => {
  it('reads users/{uid}/prefs/main and config/global', async () => {
    await createFirestorePrefsBackend('u1');
    expect(fs.doc.mock.calls.map((c) => c.slice(1).join('/'))).toEqual(['users/u1/prefs/main', 'config/global']);
  });

  it('watchPrefs: parses { f }, drops unknown fields and entries without a numeric time', async () => {
    const b = await createFirestorePrefsBackend('u1');
    const onData = vi.fn();
    b.watchPrefs(onData, vi.fn());
    fs.handlers['users/u1/prefs/main'].ok(
      snap({ f: { satellite: { v: true, t: 5 }, bogus: { v: 1, t: 1 }, sort: { v: 'x', t: 'late' }, mapOpts: 'nope' } }),
    );
    expect(onData).toHaveBeenCalledWith({ satellite: { v: true, t: 5 } });
  });

  it('watchPrefs: a missing document is null; a listener error is passed on', async () => {
    const b = await createFirestorePrefsBackend('u1');
    const onData = vi.fn();
    const onErr = vi.fn();
    b.watchPrefs(onData, onErr);
    fs.handlers['users/u1/prefs/main'].ok(snap(undefined, false));
    expect(onData).toHaveBeenCalledWith(null);
    const e = new Error('denied');
    fs.handlers['users/u1/prefs/main'].err(e);
    expect(onErr).toHaveBeenCalledWith(e);
  });

  it('kill switch: only an explicit `cloudEnabled: false` turns sync off', async () => {
    const b = await createFirestorePrefsBackend('u1');
    const on = vi.fn();
    b.watchEnabled(on);
    const h = fs.handlers['config/global'];
    h.ok(snap({ cloudEnabled: false }));
    h.ok(snap({ cloudEnabled: true }));
    h.ok(snap({}));
    h.ok(snap(undefined, false));
    h.err(new Error('offline'));
    expect(on.mock.calls.map((c) => c[0])).toEqual([false, true, true, true, true]);
  });

  it('write: replaces exactly the listed fields (mergeFields) and stamps the server time', async () => {
    const b = await createFirestorePrefsBackend('u1');
    const patch = { satellite: { v: false, t: 9 }, sort: { v: { key: 'a', dir: 1 as const }, t: 8 } };
    await b.write(patch);
    expect(fs.setDoc).toHaveBeenCalledWith(
      { path: 'users/u1/prefs/main' },
      { f: patch, updatedAt: '<server time>' },
      { mergeFields: ['f.satellite', 'f.sort', 'updatedAt'] },
    );
  });

  it('write: a failure reaches the caller', async () => {
    const b = await createFirestorePrefsBackend('u1');
    fs.setDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(b.write({ satellite: { v: true, t: 1 } })).rejects.toThrow('permission-denied');
  });
});
