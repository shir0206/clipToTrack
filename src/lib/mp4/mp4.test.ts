import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMp4 } from './parser';

function box(type: string, payload = new Uint8Array(), large = false) {
  const header = large ? 16 : 8;
  const bytes = new Uint8Array(header + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, large ? 1 : bytes.length);
  for (let index = 0; index < 4; index += 1)
    bytes[4 + index] = type.charCodeAt(index);
  if (large) view.setBigUint64(8, BigInt(bytes.length));
  bytes.set(payload, header);
  return bytes;
}

function join(...parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

describe('incremental MP4 parsing', () => {
  it('traverses ordinary and 64-bit boxes without reading the complete blob', async () => {
    const bytes = join(
      box('free', new Uint8Array(32)),
      box('moov', new Uint8Array(), true),
    );
    const reads: Array<[number, number]> = [];
    const source = {
      size: bytes.length,
      slice(start = 0, end = bytes.length) {
        reads.push([start, end]);
        return new Blob([bytes.slice(start, end)]);
      },
    } as Blob;

    await parseMp4(source, { requireTelemetry: false });

    expect(reads.length).toBeGreaterThan(1);
    expect(
      reads.some(([start, end]) => start === 0 && end === bytes.length),
    ).toBe(false);
    expect(
      Math.max(...reads.map(([start, end]) => end - start)),
    ).toBeLessThanOrEqual(16);
  });

  it('keeps reads bounded for a virtual multi-gigabyte file', async () => {
    const largeEnd = 5 * 1024 * 1024 * 1024;
    const reads: Array<[number, number]> = [];
    const source = {
      size: largeEnd + 8,
      slice(start = 0, end = largeEnd + 8) {
        reads.push([start, end]);
        const bytes = new Uint8Array(end - start);
        const view = new DataView(bytes.buffer);
        if (start === 0) {
          view.setUint32(0, 1);
          bytes.set(new TextEncoder().encode('free'), 4);
          view.setBigUint64(8, BigInt(largeEnd));
        } else if (start === largeEnd) {
          view.setUint32(0, 8);
          bytes.set(new TextEncoder().encode('moov'), 4);
        }
        return new Blob([bytes]);
      },
    } as Blob;

    await parseMp4(source, { requireTelemetry: false });

    expect(Math.max(...reads.map(([start, end]) => end - start))).toBe(16);
    expect(reads.reduce((sum, [start, end]) => sum + end - start, 0)).toBe(24);
  });

  it('returns a structured truncated-box error', async () => {
    const malformed = box('moov');
    new DataView(malformed.buffer).setUint32(0, 100);

    await expect(parseMp4(new Blob([malformed]))).rejects.toMatchObject({
      name: 'Mp4Error',
      code: 'TRUNCATED_BOX',
      offset: 0,
    });
  });

  it('returns a structured error for a box with a valid header but short payload', async () => {
    const malformed = box('moov', box('mvhd'));
    await expect(
      parseMp4(new Blob([malformed]), { requireTelemetry: false }),
    ).rejects.toMatchObject({
      code: 'TRUNCATED_BOX',
    });
  });

  it('honours cancellation before retaining the source', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseMp4(new Blob([box('free')]), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it.each([
    ['GX010753.MP4', 5312, 2988],
    ['GL010753.LRV', 768, 432],
  ])(
    'reads reference metadata and gpmd ranges from %s',
    async (name, width, height) => {
      const content = await readFile(resolve('asset', name));
      const result = await parseMp4(new File([content], name));

      expect(result.durationSeconds).toBeCloseTo(6.48, 2);
      expect(result.tracks.map((track) => track.handlerType)).toEqual(
        expect.arrayContaining(['vide', 'soun', 'tmcd', 'meta']),
      );
      expect(
        result.tracks.find((track) => track.handlerType === 'vide'),
      ).toMatchObject({
        width,
        height,
      });
      const telemetry = result.tracks.find(
        (track) => track.sampleEntry === 'gpmd',
      );
      expect(telemetry?.samples).toHaveLength(7);
      expect(result.telemetrySamples).toHaveLength(7);
      expect(
        result.telemetrySamples.every((sample) => sample.data.byteLength > 0),
      ).toBe(true);
      expect(result.sourceName).toBe(basename(name));
      expect(result.metadata.firmware).toBe('H24.01.02.10.00');
      expect(result.metadata.coordinates).toBe('+47.2900+012.6970/');
      expect(result.metadata.cameraModel).toBe('HERO13 Black');
    },
  );

  it('normalizes identical HERO13 telemetry from the MP4 and LRV sources', async () => {
    const [mp4Content, lrvContent] = await Promise.all([
      readFile(resolve('asset', 'GX010753.MP4')),
      readFile(resolve('asset', 'GL010753.LRV')),
    ]);
    const [mp4, lrv] = await Promise.all([
      parseMp4(new File([mp4Content], 'GX010753.MP4')),
      parseMp4(new File([lrvContent], 'GL010753.LRV')),
    ]);

    expect(mp4.telemetryHash).toBe(lrv.telemetryHash);
    expect(mp4.telemetry.gps).toEqual(
      lrv.telemetry.gps.map((point) => ({
        ...point,
        sourceFile: 'GX010753.MP4',
      })),
    );
    expect(mp4.telemetry.gps).toHaveLength(65);
    expect(mp4.telemetry.gps.every((point) => point.fix === 3)).toBe(true);
    expect(mp4.telemetry.gps.every((point) => point.dop === 1.37)).toBe(true);
    expect(mp4.telemetry.gps[0].utcTime).toBe('2026-09-21T08:36:35.300Z');
    expect(mp4.telemetry.gps.at(-1)?.utcTime).toBe('2026-09-21T08:36:41.700Z');

    const counts = (key: string) =>
      mp4.telemetry.streams
        .filter((stream) => stream.key === key)
        .reduce((sum, stream) => sum + stream.values.length, 0);
    expect(counts('ACCL')).toBeGreaterThanOrEqual(1_200);
    expect(counts('GYRO')).toBeGreaterThanOrEqual(1_200);
  });

  it('rejects sample offsets outside the file before attempting a read', async () => {
    const content = new Uint8Array(
      await readFile(resolve('asset', 'GL010753.LRV')),
    );
    const marker = new TextEncoder().encode('stco');
    let tables = 0;
    for (let index = 0; index <= content.length - marker.length; index += 1) {
      if (marker.every((byte, part) => content[index + part] === byte)) {
        new DataView(content.buffer).setUint32(index + 12, 0xfffffff0);
        tables += 1;
      }
    }
    expect(tables).toBeGreaterThan(0);
    await expect(parseMp4(new Blob([content]))).rejects.toMatchObject({
      code: 'INVALID_OFFSET',
    });
  });

  it('uses a stable structured error for files without telemetry', async () => {
    await expect(parseMp4(new Blob([box('moov')]))).rejects.toEqual(
      expect.objectContaining({
        name: 'Mp4Error',
        code: 'TELEMETRY_NOT_FOUND',
      }),
    );
  });
});
