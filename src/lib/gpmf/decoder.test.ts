import { describe, expect, it } from 'vitest';
import { decodeGpmfSamples, GpmfError } from './decoder';

const encoder = new TextEncoder();

function join(...parts: Uint8Array[]) {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function record(
  key: string,
  type: string | number,
  size: number,
  repeat: number,
  payload: Uint8Array,
) {
  const paddedLength = (payload.length + 3) & ~3;
  const bytes = new Uint8Array(8 + paddedLength);
  bytes.set(encoder.encode(key), 0);
  bytes[4] = typeof type === 'string' ? type.charCodeAt(0) : type;
  bytes[5] = size;
  new DataView(bytes.buffer).setUint16(6, repeat);
  bytes.set(payload, 8);
  return bytes;
}

function textRecord(key: string, value: string, size = value.length) {
  return record(
    key,
    'c',
    size,
    Math.ceil(value.length / size),
    encoder.encode(value),
  );
}

function i32(values: number[]) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, value));
  return bytes;
}

function u16(values: number[]) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value));
  return bytes;
}

function gps9Sample() {
  const structure = 'lllllllSS';
  const raw = join(
    i32([472899587, 126970259, 791845, 4794, 5000, 9760, 30995300]),
    u16([137, 3]),
  );
  const stream = join(
    textRecord('STNM', 'GPS'),
    textRecord('UNIT', 'degdegm  m/sm/s   s        ', 3),
    textRecord('TYPE', structure),
    record(
      'SCAL',
      'l',
      4,
      9,
      i32([10_000_000, 10_000_000, 1000, 1000, 1000, 1, 1000, 100, 1]),
    ),
    record('GPS9', '?', 32, 1, raw),
  );
  const nested = record('STRM', 0, 1, stream.length, stream);
  return record('DEVC', 0, 1, nested.length, nested);
}

describe('GPMF decoding', () => {
  it('decodes nested complex GPS9 data with scale arrays and absolute time', () => {
    const result = decodeGpmfSamples([gps9Sample().buffer], 'clip.lrv');

    expect(result.version).toBe(1);
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0]).toMatchObject({
      key: 'GPS9',
      name: 'GPS',
      type: 'lllllllSS',
      scale: [10_000_000, 10_000_000, 1000, 1000, 1000, 1, 1000, 100, 1],
    });
    expect(result.streams[0].samples[0].timestampSeconds).toBeUndefined();
    expect(result.gps).toHaveLength(1);
    expect(result.gps[0]).toMatchObject({
      latitude: 47.2899587,
      longitude: 12.6970259,
      altitude: 791.845,
      speed2d: 4.794,
      speed3d: 5,
      daysSince2000: 9760,
      secondsSinceMidnight: 30995.3,
      dop: 1.37,
      fix: 3,
      sourceFile: 'clip.lrv',
      sourceSampleIndex: 0,
    });
    expect(result.gps[0].utcTime).toBe('2026-09-21T08:36:35.300Z');
  });

  it('decodes primitive values, strings, FourCC, floats, doubles, and padding', () => {
    const payload = join(
      record('SINT', 's', 2, 2, new Uint8Array([0xff, 0xfe, 0, 3])),
      record('UINT', 'L', 4, 1, new Uint8Array([0, 0, 0, 7])),
      record(
        'FLOT',
        'f',
        4,
        1,
        new Uint8Array(new Float32Array([1.5]).buffer).reverse(),
      ),
      record(
        'DBLE',
        'd',
        8,
        1,
        (() => {
          const b = new Uint8Array(8);
          new DataView(b.buffer).setFloat64(0, 2.5);
          return b;
        })(),
      ),
      record('FCC ', 'F', 4, 1, encoder.encode('ABCD')),
      textRecord('TEXT', 'abc'),
    );
    const result = decodeGpmfSamples([payload.buffer]);
    expect(result.streams.map((stream) => stream.values)).toEqual([
      [-2, 3],
      [7],
      [1.5],
      [2.5],
      ['ABCD'],
      ['abc'],
    ]);
  });

  it('adapts GPS5 using GPSU, GPSP, and GPSF metadata', () => {
    const stream = join(
      textRecord('GPSU', '260921083635.300'),
      record('GPSP', 'S', 2, 1, u16([137])),
      record('GPSF', 'L', 4, 1, new Uint8Array([0, 0, 0, 3])),
      record(
        'SCAL',
        'l',
        4,
        5,
        i32([10_000_000, 10_000_000, 1000, 1000, 1000]),
      ),
      record(
        'GPS5',
        'l',
        20,
        1,
        i32([472899587, 126970259, 791845, 4794, 5000]),
      ),
    );
    const result = decodeGpmfSamples([
      record('STRM', 0, 1, stream.length, stream).buffer,
    ]);
    expect(result.gps[0]).toMatchObject({
      dop: 1.37,
      fix: 3,
      utcTime: '2026-09-21T08:36:35.300Z',
    });
  });

  it('retains unknown keys and their unpadded raw bytes', () => {
    const result = decodeGpmfSamples([
      record('ZZZZ', 'B', 1, 3, new Uint8Array([1, 2, 3])).buffer,
    ]);
    expect(result.unknownRecords).toHaveLength(1);
    expect(result.unknownRecords[0].rawPayload).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('rejects truncated records and nested payloads', () => {
    const truncated = record(
      'TEST',
      'L',
      4,
      1,
      new Uint8Array([0, 0, 0, 1]),
    ).slice(0, 10);
    expect(() => decodeGpmfSamples([truncated.buffer])).toThrow(GpmfError);

    const nested = record('STRM', 0, 1, 3, new Uint8Array([1, 2, 3]));
    expect(() => decodeGpmfSamples([nested.buffer])).toThrow(/header/i);
  });
});
