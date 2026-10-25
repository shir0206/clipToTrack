import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSyncedKey, KEY_REGISTRY, PREF_KEY, scopeOf } from './syncKeys';

const SRC = join(process.cwd(), 'src') + '/'; // vitest runs from the project root
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

// P1-T8
describe('sync key registry', () => {
  it('keeps per-device layout state out of the cloud', () => {
    for (const k of ['sheet-snap', 'force-layout', 'panel-width', 'profile-height'])
      expect(isSyncedKey(`clip-to-track:${k}`), k).toBe(false);
  });

  it('syncs preferences, clip data and the example "enabled" flag', () => {
    for (const k of [
      'settings:v1',
      'satellite-default:v1',
      'project-mode:v1',
      'playback-help-dismissed',
      'map-opts:v4',
      'sort',
      'clips:v1',
      'projects:v1',
      'clip-places:v1',
      'example',
    ])
      expect(isSyncedKey(`clip-to-track:${k}`), k).toBe(true);
    expect(scopeOf('clip-to-track:example')).toBe('partial');
  });

  it('the sync bookkeeping is never synced, but is wiped with the data it describes', () => {
    expect(scopeOf('clip-to-track:sync-meta:v1')).toBe('meta');
    expect(isSyncedKey('clip-to-track:sync-meta:v1')).toBe(false);
  });

  it('knows the retired dialog key, and treats it as not synced', () => {
    expect(scopeOf('clip-to-track:example-upload-auto:v1')).toBe('removed');
    expect(isSyncedKey('clip-to-track:example-upload-auto:v1')).toBe(false);
  });

  it('gives each synced preference exactly one key', () => {
    const fields = Object.values(KEY_REGISTRY).flatMap((e) => (e.field ? [e.field] : []));
    expect(new Set(fields).size).toBe(fields.length);
    expect(Object.keys(PREF_KEY).sort()).toEqual([...fields].sort());
  });

  it('classifies EVERY "clip-to-track:" key that appears in the source (a new key must be decided on)', () => {
    const found = new Map<string, string>();
    for (const f of files(SRC)) {
      if (!/\.(ts|tsx)$/.test(f) || /\.test\.|[\\/]test[\\/]|syncKeys\.ts$/.test(f)) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](clip-to-track:[A-Za-z0-9:_-]+)['"`]/g))
        found.set(m[1], f.replace(SRC, ''));
    }
    const unknown = [...found].filter(([k]) => !(k in KEY_REGISTRY));
    expect(unknown, `unclassified keys: ${JSON.stringify(unknown)}`).toEqual([]);
    // and the dialog key really is gone from the code
    expect(found.has('clip-to-track:example-upload-auto:v1')).toBe(false);
  });
});
