// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthStore,
  describeAuthError,
  type AuthBackend,
  type AuthUser,
} from './auth';

const ada: AuthUser = {
  uid: 'u1',
  email: 'ada@example.com',
  name: 'Ada',
  photoURL: null,
};

/** A fake Firebase: records calls, lets the test decide when auth state changes. */
function fakeBackend(over: Partial<AuthBackend> = {}) {
  let onUser: (u: AuthUser | null) => void = () => {};
  let onFail: (e: unknown) => void = () => {};
  const backend: AuthBackend = {
    onChange: vi.fn((cb, err) => {
      onUser = cb;
      onFail = err;
      return () => {};
    }),
    consumeRedirectResult: vi.fn(async () => {}),
    popup: vi.fn(async () => {}),
    redirect: vi.fn(async () => {}),
    signOut: vi.fn(async () => onUser(null)),
    ...over,
  };
  return {
    backend,
    emit: (u: AuthUser | null) => onUser(u),
    fail: (e: unknown) => onFail(e),
  };
}
const make = (
  over: Partial<AuthBackend> = {},
  extra: { redirectPreferred?: () => boolean } = {},
) => {
  const f = fakeBackend(over);
  const load = vi.fn(async () => f.backend);
  const store = createAuthStore({ available: true, load, ...extra });
  return { ...f, load, store };
};
const err = (code: string) => Object.assign(new Error(code), { code });

// P2-T1
describe('auth state', () => {
  it('starts as loading and becomes guest when there is no saved session', async () => {
    const { store, emit } = make();
    expect(store.getState().status).toBe('loading');
    await store.init();
    emit(null);
    expect(store.getState()).toMatchObject({
      status: 'guest',
      user: null,
      error: null,
    });
  });

  it('becomes user when Firebase restores a session, and guest again after sign-out', async () => {
    const { store, emit } = make();
    await store.init();
    emit(ada);
    expect(store.getState()).toMatchObject({ status: 'user', user: ada });
    emit(null);
    expect(store.getState()).toMatchObject({ status: 'guest', user: null });
  });

  it('notifies subscribers, and unsubscribing stops it', async () => {
    const { store, emit } = make();
    const spy = vi.fn();
    const off = store.subscribe(spy);
    await store.init();
    emit(ada);
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    off();
    emit(null);
    expect(spy).not.toHaveBeenCalled();
  });

  it('loads Firebase once, however often init is called', async () => {
    const { store, load } = make();
    await Promise.all([store.init(), store.init(), store.init()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('an auth listener error leaves the app as a guest app', async () => {
    const { store, fail } = make();
    await store.init();
    fail(new Error('boom'));
    expect(store.getState()).toMatchObject({ status: 'guest', user: null });
  });
});

describe('accounts not configured', () => {
  it('is a plain guest app: nothing is loaded, sign-in does nothing, no control is offered', async () => {
    const load = vi.fn();
    const store = createAuthStore({ available: false, load });
    expect(store.getState()).toMatchObject({
      status: 'guest',
      available: false,
    });
    await store.init();
    await store.signIn();
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().error).toBeNull();
  });
});

describe('Firebase cannot be loaded (offline)', () => {
  it('becomes a guest silently, and a later click retries', async () => {
    const f = fakeBackend();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(f.backend);
    const store = createAuthStore({ available: true, load });
    await store.init();
    expect(store.getState()).toMatchObject({ status: 'guest', error: null });

    await store.signIn();
    expect(load).toHaveBeenCalledTimes(2);
    expect(f.backend.popup).toHaveBeenCalledTimes(1);
  });

  it('a click while still offline shows a network message', async () => {
    const store = createAuthStore({
      available: true,
      load: vi.fn().mockRejectedValue(new Error('offline')),
    });
    await store.init();
    await store.signIn();
    expect(store.getState().error).toMatch(/Couldn.t reach Google/);
  });
});

// P2-T7
describe('signing in', () => {
  it('opens the popup synchronously inside the click once Firebase is loaded (or the browser blocks it)', async () => {
    const { store, backend } = make();
    await store.init();
    void store.signIn(); // deliberately not awaited
    expect(backend.popup).toHaveBeenCalledTimes(1); // no await happened before the popup call
  });

  it('shows no error when the person simply closes the popup', async () => {
    const { store } = make({
      popup: vi.fn().mockRejectedValue(err('auth/popup-closed-by-user')),
    });
    await store.init();
    await store.signIn();
    expect(store.getState()).toMatchObject({ error: null, signingIn: false });
  });

  it.each(['auth/cancelled-popup-request', 'auth/user-cancelled'])(
    '%s is silent too',
    async (code) => {
      const { store } = make({ popup: vi.fn().mockRejectedValue(err(code)) });
      await store.init();
      await store.signIn();
      expect(store.getState().error).toBeNull();
    },
  );

  it('shows a network message, in words, not a code', async () => {
    const { store } = make({
      popup: vi.fn().mockRejectedValue(err('auth/network-request-failed')),
    });
    await store.init();
    await store.signIn();
    expect(store.getState().error).toMatch(/Check your connection/);
    expect(store.getState().error).not.toMatch(/auth\//);
    expect(store.getState().signingIn).toBe(false);
  });

  it('explains an unauthorised domain', async () => {
    const { store } = make({
      popup: vi.fn().mockRejectedValue(err('auth/unauthorized-domain')),
    });
    await store.init();
    await store.signIn();
    expect(store.getState().error).toMatch(/isn.t set up/);
  });

  it('shows a generic message for anything unexpected', async () => {
    const { store } = make({
      popup: vi.fn().mockRejectedValue(new Error('weird internal thing')),
    });
    await store.init();
    await store.signIn();
    expect(store.getState().error).toBe('Sign-in failed. Please try again.');
  });

  it('falls back to the full-page redirect when the popup is blocked', async () => {
    const { store, backend } = make({
      popup: vi.fn().mockRejectedValue(err('auth/popup-blocked')),
    });
    await store.init();
    await store.signIn();
    expect(backend.redirect).toHaveBeenCalledTimes(1);
    expect(store.getState().error).toBeNull();
  });

  it('goes straight to the redirect where popups do not work (iOS home-screen app)', async () => {
    const { store, backend } = make({}, { redirectPreferred: () => true });
    await store.init();
    await store.signIn();
    expect(backend.popup).not.toHaveBeenCalled();
    expect(backend.redirect).toHaveBeenCalledTimes(1);
  });

  it('ignores a second click while a sign-in is open', async () => {
    let finish: () => void = () => {};
    const { store, backend } = make({
      popup: vi.fn(() => new Promise<void>((r) => (finish = r))),
    });
    await store.init();
    const first = store.signIn();
    expect(store.getState().signingIn).toBe(true);
    await store.signIn();
    expect(backend.popup).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(store.getState().signingIn).toBe(false);
  });

  it('clears the previous error when trying again, and clearError removes it', async () => {
    const popup = vi
      .fn()
      .mockRejectedValueOnce(err('auth/network-request-failed'))
      .mockResolvedValue(undefined);
    const { store } = make({ popup });
    await store.init();
    await store.signIn();
    expect(store.getState().error).not.toBeNull();
    const p = store.signIn();
    expect(store.getState().error).toBeNull();
    await p;

    const { store: s2 } = make({
      popup: vi.fn().mockRejectedValue(err('auth/network-request-failed')),
    });
    await s2.init();
    await s2.signIn();
    s2.clearError();
    expect(s2.getState().error).toBeNull();
  });

  it('shows a failure that happens after coming back from a full-page sign-in', async () => {
    const { store } = make({
      consumeRedirectResult: vi
        .fn()
        .mockRejectedValue(err('auth/network-request-failed')),
    });
    await store.init();
    await Promise.resolve();
    expect(store.getState().error).toMatch(/Check your connection/);
  });
});

describe('signing out', () => {
  it('asks Firebase to sign out and ends up as a guest', async () => {
    const { store, backend, emit } = make();
    await store.init();
    emit(ada);
    expect(await store.signOut()).toBe(true);
    expect(backend.signOut).toHaveBeenCalled();
    expect(store.getState().status).toBe('guest');
  });

  it('reports failure and stays signed in', async () => {
    const { store, emit } = make({
      signOut: vi.fn().mockRejectedValue(new Error('x')),
    });
    await store.init();
    emit(ada);
    expect(await store.signOut()).toBe(false);
    expect(store.getState()).toMatchObject({ status: 'user' });
    expect(store.getState().error).toMatch(/Couldn.t sign out/);
  });
});

// P2-T4
describe('a guest with clips signs in', () => {
  it('nothing in this browser is touched by signing in or out (no sync yet)', async () => {
    const seed = {
      'clip-to-track:clips:v1': '[{"metadata":{}}]',
      'clip-to-track:projects:v1': '[{"id":"p","clipIds":["a"]}]',
      'clip-to-track:settings:v1': '{"view":{"search":false}}',
      'clip-to-track:sheet-snap': 'half',
    };
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    const before = JSON.stringify({ ...localStorage });

    const { store, emit } = make();
    await store.init();
    await store.signIn();
    emit(ada);
    await store.signOut();

    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});

describe('describeAuthError', () => {
  it('has words for the cases people can act on, and nothing for a closed popup', () => {
    expect(describeAuthError(err('auth/popup-closed-by-user'))).toBeNull();
    expect(describeAuthError(err('auth/user-disabled'))).toMatch(/disabled/);
    expect(describeAuthError(undefined)).toBe(
      'Sign-in failed. Please try again.',
    );
  });
});
