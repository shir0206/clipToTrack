import { describe, expect, it } from 'vitest';
import { discoverClips, type SourceFile } from './discovery';
const source = (name: string, path = name, size = 10): SourceFile => ({
  file: new File([new Uint8Array(size)], name, { lastModified: 1 }),
  path,
});
describe('clip discovery', () => {
  it('groups the reference names and chooses LRV', () => {
    const r = discoverClips([
      source('GX010753.MP4'),
      source('GL010753.LRV'),
      source('GX010753.THM'),
    ]);
    expect(r.clips).toHaveLength(1);
    expect(r.clips[0].files).toHaveLength(3);
    expect(r.clips[0].telemetrySource?.file.name).toBe('GL010753.LRV');
    expect(r.clips[0].warnings).toEqual([]);
    expect(r.clips[0].totalSize).toBe(30);
  });
  it('recognizes mixed-case names and extensions', () => {
    expect(
      discoverClips([source('gx010753.mP4'), source('gL010753.lrv')]).clips,
    ).toHaveLength(1);
  });
  it('keeps an MP4 without a proxy importable', () => {
    const c = discoverClips([source('GH010123.MP4')]).clips[0];
    expect(c.telemetrySource?.file.name).toBe('GH010123.MP4');
    expect(c.warnings.join(' ')).toMatch(/LRV/);
  });
  it('keeps LRV-only and thumbnail-only groups with appropriate warnings', () => {
    expect(
      discoverClips([source('GL010753.LRV')]).clips[0].telemetrySource?.file
        .name,
    ).toBe('GL010753.LRV');
    const c = discoverClips([source('GX010753.THM')]).clips[0];
    expect(c.telemetrySource).toBeNull();
    expect(c.warnings.join(' ')).toMatch(/No video/);
  });
  it('ignores unrelated files without rejecting the scan', () => {
    const r = discoverClips([
      source('notes.txt'),
      source('photo.jpg'),
      source('GX010753.MP4'),
    ]);
    expect(r.ignoredCount).toBe(2);
    expect(r.clips).toHaveLength(1);
  });
  it('does not merge different chapters or folders', () => {
    const r = discoverClips([
      source('GX010753.MP4', 'A/GX010753.MP4'),
      source('GL010753.LRV', 'B/GL010753.LRV'),
      source('GX020753.MP4', 'A/GX020753.MP4'),
    ]);
    expect(r.clips).toHaveLength(3);
  });
  it('deduplicates repeated selections but retains conflicting versions', () => {
    const r = discoverClips([
      source('GX010753.MP4'),
      source('GX010753.MP4'),
      source('GX010753.MP4', undefined, 20),
    ]);
    expect(r.clips[0].files).toHaveLength(2);
    expect(r.clips[0].warnings.join(' ')).toMatch(/Multiple MP4/);
  });
  it('warns for renamed clips and pairs exact basenames', () => {
    const r = discoverClips([source('holiday.mp4'), source('holiday.lrv')]);
    expect(r.clips).toHaveLength(1);
    expect(r.clips[0].warnings.join(' ')).toMatch(/Nonstandard/);
  });
  it('falls back from an empty LRV to MP4', () => {
    const c = discoverClips([
      source('GX010753.MP4'),
      source('GL010753.LRV', undefined, 0),
    ]).clips[0];
    expect(c.telemetrySource?.file.name).toBe('GX010753.MP4');
    expect(c.warnings.join(' ')).toMatch(/empty/i);
  });
  it('keeps folder case distinct', () => {
    expect(
      discoverClips([
        source('GX010753.MP4', 'A/GX010753.MP4'),
        source('GL010753.LRV', 'a/GL010753.LRV'),
      ]).clips,
    ).toHaveLength(2);
  });
});
