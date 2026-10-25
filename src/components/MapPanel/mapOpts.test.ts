import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRemoteMapOpts, DEFAULT_OPTS, loadOpts, saveOpts, subscribeRemoteOpts } from './MapPanel';
import { onLocalChange } from '../../lib/sync/changeBus';
import type { SyncField } from '../../lib/sync/syncKeys';

const KEY = 'clip-to-track:map-opts:v4';
const listen = () => {
  const heard: SyncField[] = [];
  return { heard, off: onLocalChange((f) => heard.push(f)) };
};
afterEach(() => applyRemoteMapOpts({}));

describe('saveOpts only reports a REAL change', () => {
  it('the save TrackMap makes on mount (same options) is silent and writes nothing', () => {
    localStorage.clear();
    const { heard, off } = listen();
    saveOpts(loadOpts());
    expect(heard).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
    off();
  });

  it('a different basemap alone is not a change (the basemap is per device)', () => {
    const { heard, off } = listen();
    saveOpts({ ...loadOpts(), base: loadOpts().base === 'satellite' ? 'topo' : 'satellite' } as never);
    expect(heard).toEqual([]);
    off();
  });

  it('a changed option is stored and reported', () => {
    const { heard, off } = listen();
    saveOpts({ ...loadOpts(), arrows: !loadOpts().arrows });
    expect(heard).toEqual(['mapOpts']);
    expect(JSON.parse(localStorage.getItem(KEY)!).arrows).toBe(!DEFAULT_OPTS.arrows);
    off();
  });

  it('saving the same changed options again is silent', () => {
    saveOpts({ ...loadOpts(), arrows: !DEFAULT_OPTS.arrows });
    const { heard, off } = listen();
    saveOpts(loadOpts());
    expect(heard).toEqual([]);
    off();
  });
});

describe('options from the cloud', () => {
  it('are stored, not reported, and an open map is told', () => {
    const { heard, off } = listen();
    const open = vi.fn();
    const unsub = subscribeRemoteOpts(open);
    applyRemoteMapOpts({ arrows: !DEFAULT_OPTS.arrows });
    expect(open).toHaveBeenCalledTimes(1);
    expect(loadOpts().arrows).toBe(!DEFAULT_OPTS.arrows);
    expect(heard).toEqual([]);

    unsub();
    applyRemoteMapOpts({});
    expect(open).toHaveBeenCalledTimes(1);
    off();
  });

  it('the store is written BEFORE the map is told (the map re-reads it)', () => {
    let seen: boolean | undefined;
    const unsub = subscribeRemoteOpts(() => (seen = loadOpts().arrows));
    applyRemoteMapOpts({ arrows: !DEFAULT_OPTS.arrows });
    expect(seen).toBe(!DEFAULT_OPTS.arrows);
    unsub();
  });
});
