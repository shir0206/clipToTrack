import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrefSync } from './prefSync';
import { prefAdapters, setExampleEnabledHandler } from './prefAdapters';
import { fakeCloud, settle } from '../../test/fakeCloud';
import { applyRemoteSettings, DEFAULT_SETTINGS, getSettings, setView } from '../settings';
import { applyRemoteSatelliteDefault, satelliteDefault, setSatelliteDefault } from '../../config/mapDefault';
import { applyRemoteProjectMode, getProjectMode, setProjectMode } from '../../hooks/useProjects';
import { exampleState, setExampleState } from '../../components/ExampleProject/exampleProject';
import { applyRemoteMapOpts, DEFAULT_OPTS, loadOpts, saveOpts } from '../../components/MapPanel/MapPanel';
import { applyRemotePlaybackHelpDismissed, playbackHelpDismissed } from '../../components/playback/PlaybackHelp';
import { applyRemoteSortPref, getSortPref, setSortPref } from '../sortPref';

let clock = 1000;
beforeEach(() => {
  clock = 1000;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setExampleEnabledHandler(null);
  applyRemoteSettings(DEFAULT_SETTINGS);
  applyRemoteSatelliteDefault(true);
  applyRemoteProjectMode(true);
  applyRemoteMapOpts({});
  applyRemoteSortPref({ key: 'added', dir: 1 });
  applyRemotePlaybackHelpDismissed(false);
  setExampleState({ enabled: true, projectId: null, clipIds: [], videos: {} });
});

/** the real engine on the real stores (and the real change bus), against an in-memory cloud */
function app(doc: Parameters<typeof fakeCloud>[0] = null) {
  const cloud = fakeCloud(doc);
  const engine = createPrefSync({
    adapters: prefAdapters,
    loadBackend: async () => cloud.backend(),
    storage: { getItem: () => null, setItem: () => {} },
    now: () => clock,
  });
  const stop = engine.trackLocal();
  const go = async () => {
    await engine.connect('u1');
    await settle();
  };
  return { cloud, engine, stop, go };
}
const f = (v: unknown, t: number) => ({ v, t });
const debounce = () => vi.advanceTimersByTimeAsync(1600);

describe('the person changes a real store → it is sent', () => {
  it('settings, satellite, project mode, sort and map options each become one field', async () => {
    const a = app();
    await a.go();
    clock = 2000;
    setView({ search: false });
    setSatelliteDefault(false);
    setProjectMode(false);
    setSortPref({ key: 'name', dir: -1 });
    saveOpts({ ...DEFAULT_OPTS, arrows: !DEFAULT_OPTS.arrows });
    await debounce();

    const doc = a.cloud.doc!;
    expect(Object.keys(doc).sort()).toEqual(['mapOpts', 'projectMode', 'satellite', 'settings', 'sort']);
    expect((doc.settings!.v as { view: { search: boolean } }).view.search).toBe(false);
    expect(doc.satellite!.v).toBe(false);
    expect(doc.projectMode!.v).toBe(false);
    expect(doc.sort!.v).toEqual({ key: 'name', dir: -1 });
    expect(doc.mapOpts!.v).not.toHaveProperty('base'); // the basemap stays per device
    expect(a.cloud.log.writes).toHaveLength(1);
  });

  it('the example "enabled" flag is sent, and nothing else about the example', async () => {
    const a = app();
    await a.go();
    setExampleState({ projectId: 'ex', clipIds: ['e1'], videos: { e1: 'u' } }); // device-only
    setExampleState({ enabled: false });
    await debounce();
    expect(a.cloud.doc).toEqual({ exampleEnabled: f(false, 1000) });
  });

  it('"don’t show the playback help again" is read from its real key', () => {
    applyRemotePlaybackHelpDismissed(true);
    expect(prefAdapters.playbackHelp.get()).toBe(true);
  });
});

describe('a value from the cloud → the real store shows it, and nothing is sent back', () => {
  it('applies every preference', async () => {
    const a = app({
      settings: f({ view: { ...DEFAULT_SETTINGS.view, coords: false } }, 10),
      satellite: f(false, 10),
      projectMode: f(false, 10),
      sort: f({ key: 'date', dir: -1 }, 10),
      mapOpts: f({ arrows: true }, 10),
      playbackHelp: f(true, 10),
    });
    await a.go();
    expect(getSettings().view.coords).toBe(false);
    expect(satelliteDefault()).toBe(false);
    expect(getProjectMode()).toBe(false);
    expect(getSortPref()).toEqual({ key: 'date', dir: -1 });
    expect(loadOpts().arrows).toBe(true);
    expect(playbackHelpDismissed()).toBe(true);
    await debounce();
    expect(a.cloud.log.writes).toEqual([]);
  });

  it('a map that re-saves its options after applying them does not echo', async () => {
    const a = app({ mapOpts: f({ arrows: true }, 10) });
    await a.go();
    // TrackMap's effect: saveOpts(opts) after every options change
    saveOpts(loadOpts());
    await debounce();
    expect(a.cloud.log.writes).toEqual([]);
  });
});

describe('the cloud is not trusted', () => {
  it('settings: unknown keys dropped, non-boolean values replaced by the default', async () => {
    const a = app({ settings: f({ view: { search: 'yes', coords: false, hacked: true } }, 10) });
    await a.go();
    const view = getSettings().view as Record<string, unknown>;
    expect(view.search).toBe(DEFAULT_SETTINGS.view.search);
    expect(view.coords).toBe(false);
    expect(view).not.toHaveProperty('hacked');
  });

  it('settings: a value that is not an object with `view` is ignored', async () => {
    const a = app({ settings: f('boom', 10) });
    await a.go();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('map options: only known keys with the right type are taken', async () => {
    const a = app({ mapOpts: f({ color: 'rainbow', points: 'all', arrows: 'x', evil: 1, base: 'topo' }, 10) });
    await a.go();
    const o = loadOpts();
    expect(o.color).toBe(DEFAULT_OPTS.color); // invalid colour ignored
    expect(o.points).toBe('all'); // valid one taken
    expect(o.arrows).toBe(DEFAULT_OPTS.arrows);
    expect(o).not.toHaveProperty('evil');
    expect(JSON.parse(localStorage.getItem('clip-to-track:map-opts:v4')!).base).toBeUndefined();
  });

  it('booleans must be booleans; a sort needs a key and a direction of 1 or -1', async () => {
    const a = app({ satellite: f('false', 10), projectMode: f(1, 10), sort: f({ key: 'x', dir: 5 }, 10) });
    await a.go();
    expect(satelliteDefault()).toBe(true);
    expect(getProjectMode()).toBe(true);
    expect(getSortPref()).toEqual({ key: 'added', dir: 1 });
  });
});

describe('the example project follows the account', () => {
  it('uses the app’s handler (which adds / removes the example clips), not a bare flag change', async () => {
    const handler = vi.fn();
    setExampleEnabledHandler(handler);
    const a = app({ exampleEnabled: f(false, 10) });
    await a.go();
    expect(handler).toHaveBeenCalledWith(false);
    expect(exampleState().enabled).toBe(true); // only the handler decides
  });

  it('a handler that itself reports a change (like useExampleProject.setEnabled) does not echo', async () => {
    setExampleEnabledHandler((on) => setExampleState({ enabled: on }));
    const a = app({ exampleEnabled: f(false, 10) });
    await a.go();
    expect(exampleState().enabled).toBe(false);
    await debounce();
    expect(a.cloud.log.writes).toEqual([]);
  });

  it('without a handler the flag is simply flipped', async () => {
    const a = app({ exampleEnabled: f(false, 10) });
    await a.go();
    expect(exampleState().enabled).toBe(false);
  });
});

describe('without an account', () => {
  it('a guest’s changes are only timestamped, nothing is sent anywhere', async () => {
    const cloud = fakeCloud(null);
    const engine = createPrefSync({
      adapters: prefAdapters,
      loadBackend: async () => cloud.backend(),
      storage: { getItem: () => null, setItem: () => {} },
      now: () => clock,
    });
    engine.trackLocal();
    setView({ search: false });
    await debounce();
    expect(cloud.log.writes).toEqual([]);
    expect(engine.getStatus()).toBe('off');
  });
});
