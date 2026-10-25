// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wipeSyncedLocalData, wipeThenReload } from './wipeLocal';

const P = 'clip-to-track:';
beforeEach(() => localStorage.clear());
const SYNCED = [
  'clips:v1',
  'projects:v1',
  'clip-places:v1',
  'settings:v1',
  'satellite-default:v1',
  'project-mode:v1',
  'playback-help-dismissed',
  'map-opts:v4',
  'sort',
];
const DEVICE = ['sheet-snap', 'force-layout', 'panel-width', 'profile-height'];

const seed = () => {
  for (const k of [...SYNCED, ...DEVICE, 'example'])
    localStorage.setItem(P + k, 'x');
  localStorage.setItem('some-other-app:key', 'keep me');
};

// P2-T5 / T6 (the data side)
describe('wipeSyncedLocalData', () => {
  it('removes every synced preference and all clip / project data', () => {
    seed();
    const removed = wipeSyncedLocalData();
    for (const k of SYNCED) expect(localStorage.getItem(P + k), k).toBeNull();
    expect(removed.sort()).toEqual(SYNCED.map((k) => P + k).sort());
  });

  it('keeps per-device layout, the example bookkeeping and keys it does not own', () => {
    seed();
    wipeSyncedLocalData();
    for (const k of DEVICE) expect(localStorage.getItem(P + k), k).toBe('x');
    expect(localStorage.getItem(`${P}example`)).toBe('x');
    expect(localStorage.getItem('some-other-app:key')).toBe('keep me');
  });

  it('does nothing (and does not throw) on an empty browser', () => {
    expect(wipeSyncedLocalData()).toEqual([]);
  });
});

describe('wipeThenReload', () => {
  it('wipes, then reloads', () => {
    seed();
    const order: string[] = [];
    const reload = vi.fn(() =>
      order.push(`reload:${localStorage.getItem(`${P}clips:v1`)}`),
    );
    wipeThenReload(reload);
    expect(order).toEqual(['reload:null']); // already wiped when the reload starts
  });

  it('wipes again as the page unloads, so a late write cannot bring the old data back', () => {
    seed();
    wipeThenReload(() => {});
    localStorage.setItem(`${P}clip-places:v1`, '{"a":"Innsbruck"}'); // e.g. a lookup finishing late
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(`${P}clip-places:v1`)).toBeNull();
  });
});
