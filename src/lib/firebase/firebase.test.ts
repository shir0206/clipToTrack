import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('firebase/auth');
  vi.doUnmock('./app');
});

describe('app.ts: accounts switch themselves off without config', () => {
  it('is not configured when the env vars are missing', async () => {
    vi.resetModules();
    const { isFirebaseConfigured } = await import('./app');
    expect(isFirebaseConfigured()).toBe(false);
  });

  it('is not configured when only some are set', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'k');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'p');
    vi.resetModules();
    const { isFirebaseConfigured } = await import('./app');
    expect(isFirebaseConfigured()).toBe(false);
  });

  it.each([
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
  ])('is not configured when only %s is missing', async (missing) => {
    const all: Record<string, string> = {
      VITE_FIREBASE_API_KEY: 'k',
      VITE_FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'p',
      VITE_FIREBASE_APP_ID: 'a',
    };
    for (const [k, v] of Object.entries(all))
      vi.stubEnv(k, k === missing ? '' : v);
    vi.resetModules();
    const { isFirebaseConfigured } = await import('./app');
    expect(isFirebaseConfigured()).toBe(false);
  });

  it('is configured when all four are set; the emulator flag is separate', async () => {
    for (const [k, v] of Object.entries({
      VITE_FIREBASE_API_KEY: 'k',
      VITE_FIREBASE_AUTH_DOMAIN: 'x.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'p',
      VITE_FIREBASE_APP_ID: 'a',
    }))
      vi.stubEnv(k, v);
    vi.resetModules();
    let m = await import('./app');
    expect(m.isFirebaseConfigured()).toBe(true);
    expect(m.shouldUseEmulators()).toBe(false);

    vi.stubEnv('VITE_USE_FIREBASE_EMULATORS', '1');
    vi.resetModules();
    m = await import('./app');
    expect(m.shouldUseEmulators()).toBe(true);
  });
});

describe('firebaseBackend.ts', () => {
  const setup = async (emulators: boolean) => {
    const fb = {
      getAuth: vi.fn(() => ({ name: 'auth' })),
      connectAuthEmulator: vi.fn(),
      GoogleAuthProvider: vi.fn(function (this: {
        setCustomParameters: unknown;
      }) {
        this.setCustomParameters = vi.fn();
      }),
      onAuthStateChanged: vi.fn((_a: unknown, cb: (u: unknown) => void) => {
        cb({
          uid: 'u1',
          email: 'a@b.c',
          displayName: 'Ada',
          photoURL: 'p.jpg',
          extra: 'ignored',
        });
        return () => {};
      }),
      signInWithPopup: vi.fn(async () => {}),
      signInWithRedirect: vi.fn(async () => {}),
      getRedirectResult: vi.fn(async () => null),
      signOut: vi.fn(async () => {}),
    };
    vi.doMock('firebase/auth', () => fb);
    vi.doMock('./app', () => ({
      getFirebaseApp: async () => ({ name: 'app' }),
      shouldUseEmulators: () => emulators,
    }));
    const { loadFirebaseBackend } = await import('./firebaseBackend');
    return { fb, backend: await loadFirebaseBackend() };
  };

  it('maps a Firebase user to the app user and drops everything else', async () => {
    const { backend } = await setup(false);
    const cb = vi.fn();
    backend.onChange(cb, vi.fn());
    expect(cb).toHaveBeenCalledWith({
      uid: 'u1',
      email: 'a@b.c',
      name: 'Ada',
      photoURL: 'p.jpg',
    });
  });

  it('passes null through when signed out', async () => {
    const { fb, backend } = await setup(false);
    fb.onAuthStateChanged.mockImplementationOnce(
      (_a: unknown, cb: (u: unknown) => void) => {
        cb(null);
        return () => {};
      },
    );
    const cb = vi.fn();
    backend.onChange(cb, vi.fn());
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('uses Google with the account chooser, for popup and redirect', async () => {
    const { fb, backend } = await setup(false);
    await backend.popup();
    await backend.redirect();
    const provider = fb.GoogleAuthProvider.mock.instances[0] as unknown as {
      setCustomParameters: ReturnType<typeof vi.fn>;
    };
    expect(provider.setCustomParameters).toHaveBeenCalledWith({
      prompt: 'select_account',
    });
    expect(fb.signInWithPopup).toHaveBeenCalledWith({ name: 'auth' }, provider);
    expect(fb.signInWithRedirect).toHaveBeenCalledWith(
      { name: 'auth' },
      provider,
    );
  });

  it('signs out and consumes the redirect result', async () => {
    const { fb, backend } = await setup(false);
    await backend.signOut();
    await backend.consumeRedirectResult();
    expect(fb.signOut).toHaveBeenCalled();
    expect(fb.getRedirectResult).toHaveBeenCalled();
  });

  it('connects to the local emulator only when asked', async () => {
    const off = await setup(false);
    expect(off.fb.connectAuthEmulator).not.toHaveBeenCalled();
    vi.resetModules();
    const on = await setup(true);
    expect(on.fb.connectAuthEmulator).toHaveBeenCalledWith(
      { name: 'auth' },
      'http://127.0.0.1:9099',
      { disableWarnings: true },
    );
  });
});
