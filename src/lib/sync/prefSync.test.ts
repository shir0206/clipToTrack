import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrefSync, META_KEY, stable } from './prefSync';
import { device, fakeCloud, settle } from '../../test/fakeCloud';

let clock = 1000;
const now = () => clock;
beforeEach(() => {
  clock = 1000;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const debounce = () => vi.advanceTimersByTimeAsync(1600);
const connect = async (d: ReturnType<typeof device>, uid = 'u1') => {
  await d.engine.connect(uid);
  await settle();
};
const field = (v: unknown, t: number) => ({ v, t });

// ───────── P3-T1: who wins ─────────
describe('first time this device meets the account', () => {
  it('the cloud wins for every field it has, even over a newer guest choice', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    const d = device(cloud, { satellite: false }, { now });
    d.person('satellite', false); // the guest chose this at t=1000, newer than the cloud's 100
    await connect(d);
    expect(d.values.satellite).toBe(true);
    expect(cloud.log.writes).toEqual([]);
  });

  it('a guest choice fills a field the cloud lacks', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    const d = device(cloud, { sort: { key: 'name', dir: 1 } }, { now });
    d.person('sort', { key: 'name', dir: 1 });
    await connect(d);
    expect(cloud.doc!.sort).toEqual(field({ key: 'name', dir: 1 }, 1000));
  });

  it('a field nobody ever changed is not written (defaults are not choices)', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, { satellite: true, projectMode: true }, { now });
    await connect(d);
    expect(cloud.log.writes).toEqual([]);
    expect(d.engine.getStatus()).toBe('live');
  });

  it('with no local choice the cloud value is applied', async () => {
    const cloud = fakeCloud({ projectMode: field(false, 50) });
    const d = device(cloud, { projectMode: true }, { now });
    await connect(d);
    expect(d.values.projectMode).toBe(false);
  });

  it('a cloud value equal to the local one is not "applied"', async () => {
    const cloud = fakeCloud({ satellite: field(true, 50) });
    const d = device(cloud, { satellite: true }, { now });
    await connect(d);
    expect(d.applied).toEqual([]);
  });
});

describe('a device that already knows the account: the newer change wins', () => {
  /** connect once so the device is "linked", then disconnect and let the test set the scene */
  const linked = async (cloudDoc: Parameters<typeof fakeCloud>[0], init = {}) => {
    const cloud = fakeCloud(cloudDoc);
    const d = device(cloud, init, { now });
    await connect(d);
    d.engine.disconnect();
    cloud.log.writes.length = 0;
    return { cloud, d };
  };

  it('cloud newer → applied', async () => {
    const { cloud, d } = await linked({ satellite: field(true, 100) }, { satellite: true });
    clock = 2000;
    d.person('satellite', false); // local change at t=2000
    cloud.external({ satellite: field(true, 3000) }); // another device, later
    await connect(d);
    expect(d.values.satellite).toBe(true);
    expect(cloud.log.writes).toEqual([]);
  });

  it('local newer → pushed, with the time of the change (not of the push)', async () => {
    const { cloud, d } = await linked({ satellite: field(true, 100) }, { satellite: true });
    clock = 2000;
    d.person('satellite', false);
    clock = 9000; // connects much later
    await connect(d);
    expect(cloud.doc!.satellite).toEqual(field(false, 2000));
    expect(d.values.satellite).toBe(false);
  });

  it('a tie goes to the cloud', async () => {
    const { cloud, d } = await linked({ satellite: field(true, 100) }, { satellite: true });
    clock = 2000;
    d.person('satellite', false);
    cloud.external({ satellite: field(true, 2000) });
    await connect(d);
    expect(d.values.satellite).toBe(true);
  });

  it('local newer but already equal to the cloud: nothing is written', async () => {
    const { cloud, d } = await linked({ satellite: field(true, 100) }, { satellite: true });
    clock = 2000;
    d.person('satellite', false);
    d.person('satellite', true);
    await connect(d);
    expect(cloud.log.writes).toEqual([]);
  });
});

// ───────── sending ─────────
describe('sending local changes', () => {
  it('P3-T2: one change writes one field, nothing else', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100), sort: field({ key: 'added', dir: 1 }, 100) });
    const d = device(cloud, {}, { now });
    await connect(d);
    clock = 2000;
    d.person('satellite', false);
    clock = 9000; // the pause ends much later: the field carries the time of the CHANGE
    await debounce();
    expect(cloud.log.writes).toEqual([{ satellite: field(false, 2000) }]);
    expect(cloud.doc!.sort).toEqual(field({ key: 'added', dir: 1 }, 100)); // untouched
  });

  it('P3-T4: ten quick changes make one write, with the final value', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, {}, { now });
    await connect(d);
    for (let i = 0; i < 10; i++) {
      clock += 10;
      d.person('satellite', i % 2 === 0);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(cloud.log.writes).toHaveLength(0); // still inside the pause
    await debounce();
    expect(cloud.log.writes).toHaveLength(1);
    expect(cloud.log.writes[0].satellite!.v).toBe(false);
  });

  it('changes to different fields in one pause go out together', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, {}, { now });
    await connect(d);
    d.person('satellite', false);
    d.person('projectMode', false);
    await debounce();
    expect(cloud.log.writes).toHaveLength(1);
    expect(Object.keys(cloud.log.writes[0]).sort()).toEqual(['projectMode', 'satellite']);
  });

  it('a change that ends equal to the cloud is not written', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    const d = device(cloud, { satellite: true }, { now });
    await connect(d);
    d.person('satellite', false);
    d.person('satellite', true);
    await debounce();
    expect(cloud.log.writes).toEqual([]);
  });

  it('flush() sends at once and resolves when the write is done', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, {}, { now });
    await connect(d);
    d.person('satellite', false);
    await d.engine.flush();
    expect(cloud.doc!.satellite!.v).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(cloud.log.writes).toHaveLength(1); // the timer did not send it a second time
  });

  it('flush() with nothing to send resolves', async () => {
    const d = device(fakeCloud(null), {}, { now });
    await expect(d.engine.flush()).resolves.toBeUndefined();
  });
});

// ───────── receiving ─────────
describe('receiving changes from the cloud', () => {
  it('P3-T3: applies them and writes nothing back', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    const d = device(cloud, {}, { now });
    await connect(d);
    cloud.external({ satellite: field(false, 5000) });
    await debounce();
    expect(d.values.satellite).toBe(false);
    expect(cloud.log.writes).toEqual([]);
  });

  it('a store that re-saves what it just applied does not echo, and does not look like a fresh edit', async () => {
    const cloud = fakeCloud({ mapOpts: field({ arrows: false }, 100) });
    const d = device(cloud, {}, { now, echoOnApply: true });
    clock = 5000; // "now" when the value arrives, and when the store re-saves it
    await connect(d);
    await debounce();
    expect(cloud.log.writes).toEqual([]); // no echo write

    // Had the echo stamped t=5000 on the field, this genuine change (made elsewhere at t=300) would look older
    // than a local edit and be ignored.
    cloud.external({ mapOpts: field({ arrows: true }, 300) });
    await settle();
    expect(d.values.mapOpts).toEqual({ arrows: true });
  });

  it('a store that changes the value while applying it (sanitising) and reports it at once is not an edit', async () => {
    const cloud = fakeCloud({ satellite: field('weird', 100) });
    const d = device(cloud, {}, { now });
    d.adapters.satellite.apply = (v) => {
      d.person('satellite', v === 'weird' ? true : v); // stores "true" instead, and reports the change right away
    };
    clock = 5000;
    await connect(d);
    await debounce();
    expect(d.values.satellite).toBe(true);
    expect(cloud.log.writes).toEqual([]); // the sanitised value is not sent back
    expect(JSON.parse(d.store.get(META_KEY)!).t.satellite).toBe(100); // and it did not stamp the time
  });

  it('an older cloud value does not beat a change made here', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    const d = device(cloud, {}, { now });
    await connect(d);
    clock = 3000;
    d.person('satellite', false); // pending, not sent yet
    cloud.external({ satellite: field(true, 2000) }); // older than our change
    await settle();
    expect(d.values.satellite).toBe(false);
    await debounce();
    expect(cloud.doc!.satellite).toEqual(field(false, 3000));
  });

  it('ignores fields this version does not know and values that fail validation', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    (cloud as unknown as { external: (p: unknown) => void }).external({ bogus: field(1, 1), projectMode: field(null, 5) });
    const d = device(cloud, {}, { now });
    await connect(d);
    expect(d.values.bogus).toBeUndefined();
    expect(d.values.projectMode).toBeUndefined(); // null fails the (test) validator
    expect(d.values.satellite).toBe(true);
  });

  it('ignores entries without a numeric time', async () => {
    const cloud = fakeCloud(null);
    (cloud as unknown as { external: (p: unknown) => void }).external({ satellite: { v: true } });
    const d = device(cloud, {}, { now });
    await connect(d);
    expect(d.applied).toEqual([]);
  });
});

// ───────── P3-T5: two devices ─────────
describe('two devices, one account', () => {
  it('a change on A reaches B, and the exchange ends (no ping-pong)', async () => {
    const cloud = fakeCloud(null);
    const A = device(cloud, { satellite: true }, { now });
    const B = device(cloud, { satellite: true }, { now, echoOnApply: true });
    await connect(A);
    await connect(B);

    clock = 2000;
    A.person('satellite', false);
    await debounce();
    await settle();
    expect(B.values.satellite).toBe(false);

    await debounce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cloud.log.writes).toHaveLength(1);
  });

  it('different fields changed on both devices at once: both survive', async () => {
    const cloud = fakeCloud(null);
    const A = device(cloud, {}, { now });
    const B = device(cloud, {}, { now });
    await connect(A);
    await connect(B);
    clock = 2000;
    A.person('satellite', false);
    B.person('projectMode', false);
    await debounce();
    await settle();
    expect(cloud.doc!.satellite!.v).toBe(false);
    expect(cloud.doc!.projectMode!.v).toBe(false);
    expect(A.values.projectMode).toBe(false);
    expect(B.values.satellite).toBe(false);
  });

  it('the same field changed on both: the later change wins on both', async () => {
    const cloud = fakeCloud(null);
    const A = device(cloud, {}, { now });
    const B = device(cloud, {}, { now });
    await connect(A);
    await connect(B);
    clock = 2000;
    A.person('sort', { key: 'name', dir: 1 });
    clock = 2500;
    B.person('sort', { key: 'date', dir: -1 });
    await debounce();
    await settle();
    await debounce();
    expect(A.values.sort).toEqual({ key: 'date', dir: -1 });
    expect(B.values.sort).toEqual({ key: 'date', dir: -1 });
  });

  it('a brand-new device gets the account settings, the old device keeps its own', async () => {
    const cloud = fakeCloud(null);
    const A = device(cloud, {}, { now });
    await connect(A);
    clock = 2000;
    A.person('satellite', false);
    A.person('sort', { key: 'name', dir: -1 });
    await debounce();

    const phone = device(cloud, { satellite: true, sort: { key: 'added', dir: 1 } }, { now });
    await connect(phone);
    expect(phone.values.satellite).toBe(false);
    expect(phone.values.sort).toEqual({ key: 'name', dir: -1 });
  });
});

// ───────── P3-T7: offline ─────────
describe('offline', () => {
  it('changes made offline reach the other device when the line is back', async () => {
    const cloud = fakeCloud(null);
    const A = device(cloud, {}, { now });
    const B = device(cloud, {}, { now });
    await connect(A);
    await connect(B);

    cloud.goOffline();
    clock = 2000;
    A.person('satellite', false);
    clock = 2100;
    A.person('projectMode', false);
    await debounce();
    expect(B.values.satellite).toBeUndefined(); // nothing arrived yet

    cloud.goOnline();
    await settle();
    expect(B.values.satellite).toBe(false);
    expect(B.values.projectMode).toBe(false);
  });

  it('an offline change on A and a different one on B both survive', async () => {
    const cloud = fakeCloud(null);
    const A = device(cloud, {}, { now });
    const B = device(cloud, {}, { now });
    await connect(A);
    await connect(B);
    cloud.goOffline();
    clock = 2000;
    A.person('satellite', false);
    await debounce();
    cloud.goOnline(); // A's change lands
    clock = 3000;
    cloud.external({ sort: field({ key: 'name', dir: 1 }, 3000) });
    await settle();
    expect(A.values.sort).toEqual({ key: 'name', dir: 1 });
    expect(B.values.satellite).toBe(false);
  });
});

// ───────── P3-T8: the kill switch ─────────
describe('kill switch (config/global.cloudEnabled)', () => {
  it('off from the start: the prefs document is never read, nothing is written', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    cloud.setEnabled(false);
    const d = device(cloud, {}, { now });
    await connect(d);
    d.person('projectMode', false);
    await debounce();
    expect(cloud.log.prefsListens).toBe(0);
    expect(cloud.log.writes).toEqual([]);
    expect(d.values.satellite).toBeUndefined();
    expect(d.engine.getStatus()).toBe('paused');
  });

  it('switched off during a session: stops reading and writing, and says so', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, {}, { now });
    await connect(d);
    cloud.setEnabled(false);
    d.person('satellite', false);
    await debounce();
    cloud.external({ sort: field({ key: 'name', dir: 1 }, 9000) });
    await settle();
    expect(cloud.log.writes).toEqual([]);
    expect(d.values.sort).toBeUndefined();
    expect(d.engine.getStatus()).toBe('paused');
  });

  it('switched back on: it reconnects, and what was changed meanwhile is sent', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, {}, { now });
    await connect(d); // links the account
    cloud.setEnabled(false);
    clock = 2000;
    d.person('satellite', false);
    cloud.setEnabled(true);
    await settle();
    expect(d.engine.getStatus()).toBe('live');
    expect(cloud.doc!.satellite).toEqual(field(false, 2000));
  });

  it('a missing kill-switch document means enabled', async () => {
    const d = device(fakeCloud(null), {}, { now });
    await connect(d);
    expect(d.engine.getStatus()).toBe('live');
  });
});

// ───────── failures and lifecycle ─────────
describe('failures', () => {
  it('a rejected write sets the error state, and the next change tries again', async () => {
    const cloud = fakeCloud(null);
    let fail = true;
    const d = device(cloud, {}, { now, backendOpts: { failWrites: () => fail } });
    await connect(d);
    d.person('satellite', false);
    await debounce();
    await settle();
    expect(d.engine.getStatus()).toBe('error');
    expect(cloud.doc).toBeNull();

    fail = false;
    clock = 3000;
    d.person('satellite', false); // same value again counts: the cloud never got it
    await debounce();
    await settle();
    expect(cloud.doc!.satellite!.v).toBe(false);
    expect(d.engine.getStatus()).toBe('live');
  });

  it('loading the backend fails: error state, and the app goes on', async () => {
    const d = device(fakeCloud(null), {}, { now });
    const eng = createPrefSync({
      adapters: d.adapters,
      loadBackend: async () => {
        throw new Error('offline');
      },
      onLocal: () => () => {},
      storage: { getItem: () => null, setItem: () => {} },
    });
    await eng.connect('u1');
    expect(eng.getStatus()).toBe('error');
  });

  it('a snapshot error sets the error state', async () => {
    const cloud = fakeCloud(null);
    const real = cloud.backend;
    cloud.backend = (o) => ({ ...real(o), watchPrefs: (_ok, err) => (queueMicrotask(() => err(new Error('denied'))), () => {}) });
    const d = device(cloud, {}, { now });
    await connect(d);
    expect(d.engine.getStatus()).toBe('error');
  });
});

describe('lifecycle', () => {
  it('disconnect stops everything: no more changes applied, no pending write sent, status off', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, {}, { now });
    await connect(d);
    d.person('satellite', false);
    d.engine.disconnect();
    await debounce();
    cloud.external({ sort: field({ key: 'name', dir: 1 }, 9000) });
    await settle();
    expect(cloud.log.writes).toEqual([]);
    expect(d.values.sort).toBeUndefined();
    expect(d.engine.getStatus()).toBe('off');
  });

  it('connecting twice as the same person does nothing the second time', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, {}, { now });
    await connect(d);
    await connect(d);
    expect(cloud.log.prefsListens).toBe(1);
  });

  it('switching person drops the first connection, and a slow first load cannot take over', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    const d = device(cloud, {}, { now });
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));
    const eng = createPrefSync({
      adapters: d.adapters,
      loadBackend: async () => (await slow, cloud.backend()),
      onLocal: () => () => {},
      storage: { getItem: () => null, setItem: () => {} },
    });
    const first = eng.connect('u1');
    eng.disconnect();
    release();
    await first;
    await settle();
    expect(cloud.log.prefsListens).toBe(0); // the stale connection never started listening
    expect(cloud.log.enabledListens).toBe(0); // …not even for the kill switch
    expect(eng.getStatus()).toBe('off');
  });
});

// ───────── bookkeeping ─────────
describe('this device’s bookkeeping', () => {
  it('records the time of the person’s changes even as a guest, and keeps it in storage', async () => {
    const cloud = fakeCloud(null);
    const d = device(cloud, {}, { now });
    clock = 4321;
    d.person('satellite', false);
    expect(JSON.parse(d.store.get(META_KEY)!).t.satellite).toBe(4321);
  });

  it('remembers which accounts it has met: a restart treats the account as known', async () => {
    const cloud = fakeCloud({ satellite: field(true, 100) });
    const store = new Map<string, string>();
    const first = device(cloud, {}, { now, storage: store });
    await connect(first);
    first.engine.disconnect();
    first.stop();
    expect(JSON.parse(store.get(META_KEY)!).linked).toEqual(['u1']);

    // new page load, same storage: a local change newer than the cloud now wins
    const again = device(cloud, { satellite: true }, { now, storage: store });
    clock = 5000;
    again.person('satellite', false);
    await connect(again);
    expect(cloud.doc!.satellite).toEqual(field(false, 5000));
  });

  it('survives damaged bookkeeping', async () => {
    const store = new Map([[META_KEY, '{"t": "nonsense", "linked": [1, "u1"]']]);
    const d = device(fakeCloud(null), {}, { now, storage: store });
    await connect(d);
    expect(d.engine.getStatus()).toBe('live');
  });

  it('a second account on the same device: the cloud wins as on a first meeting', async () => {
    const cloudA = fakeCloud({ satellite: field(true, 100) });
    const cloudB = fakeCloud({ satellite: field(false, 50) });
    const store = new Map<string, string>();
    const d1 = device(cloudA, {}, { now, storage: store });
    await connect(d1, 'alice');
    d1.engine.disconnect();
    d1.stop();

    const d2 = device(cloudB, { satellite: true }, { now, storage: store });
    clock = 9000;
    d2.person('satellite', true);
    await connect(d2, 'bob');
    expect(d2.values.satellite).toBe(false); // bob's account decides
  });
});

describe('stable()', () => {
  it('is the same for equal values whatever the key order', () => {
    expect(stable({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } })).toBe(stable({ b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 }));
    expect(stable({ a: 1 })).not.toBe(stable({ a: 2 }));
  });
});
