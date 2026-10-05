import { describe, expect, it } from 'vitest';
import { clipFromMetadata, type ClipMetadata } from './clipFromMetadata';

const baseMetadata: ClipMetadata = {
  source: { fileName: 'GX010001.MP4' },
  file: { createdUtc: '2026-10-04T12:00:00Z' },
  gps: {
    startUtc: '2026-10-04T12:00:00Z',
    totalDistanceM: 125,
    altitudeM: { min: 12.3, max: 48.7 },
    speed3dKmh: { max: 61 },
    track: [
      { lat: 53.34, lon: -6.26 },
      { lat: 53.35, lon: -6.27 },
    ],
  },
};

describe('clipFromMetadata', () => {
  it('summarizes altitude using the rounded highest recorded value', () => {
    const clip = clipFromMetadata(baseMetadata);

    expect(clip.altitude).toBe('49 m');
  });
});
