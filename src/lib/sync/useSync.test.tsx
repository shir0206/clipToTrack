import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../firebase/auth';

const h = vi.hoisted(() => ({
  auth: {} as AuthState,
  status: 'off' as string,
  engine: {
    trackLocal: vi.fn(() => vi.fn()),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    flush: vi.fn(async () => {}),
  },
}));
vi.mock('../firebase/auth', () => ({ useAuth: () => h.auth }));
vi.mock('./prefSync', () => ({ prefSync: h.engine, useSyncStatus: () => h.status }));

import { useSync } from './useSync';
import { prefAdapters } from './prefAdapters';
import { exampleState, setExampleState } from '../../components/ExampleProject/exampleProject';

const user = (uid = 'u1'): AuthState => ({
  status: 'user', user: { uid, email: 'a@b.c', name: null, photoURL: null }, error: null, available: true, signingIn: false,
});
const guest = (status: AuthState['status'] = 'guest'): AuthState => ({
  status, user: null, error: null, available: true, signingIn: false,
});

beforeEach(() => {
  h.auth = guest();
  h.status = 'off';
  Object.values(h.engine).forEach((m) => m.mockClear());
  setExampleState({ enabled: true });
});

describe('useSync', () => {
  it('a guest: local changes are timestamped, nothing connects', () => {
    renderHook(() => useSync());
    expect(h.engine.trackLocal).toHaveBeenCalledTimes(1);
    expect(h.engine.connect).not.toHaveBeenCalled();
  });

  it('while a saved session is being restored: no connection yet', () => {
    h.auth = guest('loading');
    renderHook(() => useSync());
    expect(h.engine.connect).not.toHaveBeenCalled();
  });

  it('signed in: connects with the person’s uid', () => {
    h.auth = user('abc');
    renderHook(() => useSync());
    expect(h.engine.connect).toHaveBeenCalledWith('abc');
  });

  it('signing out disconnects', () => {
    h.auth = user();
    const { rerender } = renderHook(() => useSync());
    h.auth = guest();
    rerender();
    expect(h.engine.disconnect).toHaveBeenCalled();
  });

  it('a different person reconnects; re-rendering as the same person does not', () => {
    h.auth = user('a');
    const { rerender } = renderHook(() => useSync());
    rerender();
    expect(h.engine.connect).toHaveBeenCalledTimes(1);
    h.auth = user('b');
    rerender();
    expect(h.engine.disconnect).toHaveBeenCalledTimes(1);
    expect(h.engine.connect).toHaveBeenLastCalledWith('b');
  });

  it('unmounting disconnects and stops tracking', () => {
    const stop = vi.fn();
    h.engine.trackLocal.mockReturnValueOnce(stop);
    h.auth = user();
    const { unmount } = renderHook(() => useSync());
    unmount();
    expect(h.engine.disconnect).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it('returns the sync status', () => {
    h.status = 'live';
    expect(renderHook(() => useSync()).result.current).toBe('live');
  });

  it('sends pending changes when the tab is hidden, not when it is shown', () => {
    renderHook(() => useSync());
    const set = (v: DocumentVisibilityState) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    set('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.engine.flush).not.toHaveBeenCalled();
    set('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.engine.flush).toHaveBeenCalledTimes(1);
    set('visible');
  });
});

describe('the example project handler', () => {
  it('a remote "enabled" goes to the app’s handler, and always to the newest one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSync({ onExampleEnabled: cb }), { initialProps: { cb: first } });
    rerender({ cb: second });
    prefAdapters.exampleEnabled.apply(false);
    expect(second).toHaveBeenCalledWith(false);
    expect(first).not.toHaveBeenCalled();
  });

  it('after unmount, or with no handler, the flag is simply flipped', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useSync({ onExampleEnabled: cb }));
    unmount();
    prefAdapters.exampleEnabled.apply(false);
    expect(cb).not.toHaveBeenCalled();
    expect(exampleState().enabled).toBe(false);
  });
});
