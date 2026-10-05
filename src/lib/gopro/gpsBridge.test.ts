import { expect, it } from 'vitest';
import type { ClipMetadata } from './clipFromMetadata';
import { pickAnchors } from './gpsBridge';

it('ignores legacy real-fix metadata without anchor coordinates', () => {
  const legacy: ClipMetadata = {
    gps: {
      fixType: 3,
      startUtc: '2026-10-04T10:00:00.000Z',
      endUtc: '2026-10-04T10:01:00.000Z',
      track: [
        {
          lat: 53,
          lon: -6,
          utc: '2026-10-04T10:00:00.000Z',
        },
      ],
    },
  };

  expect(() =>
    pickAnchors(
      [legacy],
      Date.parse('2026-10-04T10:02:00.000Z'),
      Date.parse('2026-10-04T10:03:00.000Z'),
    ),
  ).not.toThrow();
});
