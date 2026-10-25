import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRemoteSortPref, getSortPref, isSortPref, setSortPref, useSortPref } from './sortPref';
import { onLocalChange } from './sync/changeBus';
import type { SyncField } from './sync/syncKeys';

afterEach(() => applyRemoteSortPref({ key: 'added', dir: 1 }));

describe('sort preference store', () => {
  it('validates the shape', () => {
    expect(isSortPref({ key: 'name', dir: 1 })).toBe(true);
    expect(isSortPref({ key: 'name', dir: -1 })).toBe(true);
    for (const bad of [null, 'x', {}, { key: 1, dir: 1 }, { key: 'a', dir: 0 }, { key: 'a', dir: 2 }])
      expect(isSortPref(bad), JSON.stringify(bad)).toBe(false);
  });

  it('a change by the person updates the hook, is stored, and is reported', () => {
    const heard: SyncField[] = [];
    const off = onLocalChange((f) => heard.push(f));
    const { result } = renderHook(() => useSortPref());
    act(() => setSortPref({ key: 'name', dir: -1 }));
    expect(result.current).toEqual({ key: 'name', dir: -1 });
    expect(JSON.parse(localStorage.getItem('clip-to-track:sort')!)).toEqual({ key: 'name', dir: -1 });
    expect(heard).toEqual(['sort']);
    off();
  });

  it('a value from the cloud updates the hook and the store but is not reported', () => {
    const heard: SyncField[] = [];
    const off = onLocalChange((f) => heard.push(f));
    const { result } = renderHook(() => useSortPref());
    act(() => {
      applyRemoteSortPref({ key: 'date', dir: 1 });
    });
    expect(result.current).toEqual({ key: 'date', dir: 1 });
    expect(heard).toEqual([]);
    off();
  });

  it('refuses an invalid remote value', () => {
    applyRemoteSortPref({ key: 'zzz', dir: 9 } as never);
    expect(getSortPref()).toEqual({ key: 'added', dir: 1 });
  });
});
