import { describe, expect, it } from 'vitest';
import { speedometerTimeline } from './speedometerTimeline';

describe('speedometer export timeline', () => {
  const samples = [
    { lat: 0, lon: 0, utc: '2026-01-01T00:00:00Z', speed3dKmh: 0, altM: 100 },
    { lat: 0, lon: 0, utc: '2026-01-01T00:00:02Z', speed3dKmh: 40, altM: 120 },
  ];
  it('interpolates telemetry by timestamp rather than rendering speed', () => {
    const timeline = speedometerTimeline(samples, 2);
    expect(timeline.at(1).sample.speed3dKmh).toBe(20);
    expect(timeline.at(1).sample.altM).toBe(110);
    expect(timeline.duration).toBe(2);
    expect(timeline.at(2).sample.speed3dKmh).toBe(40);
  });
  it('uses clip duration when UTC timestamps are unavailable', () => {
    const timeline = speedometerTimeline(
      samples.map((p) => ({ ...p, utc: undefined })),
      4,
    );
    expect(timeline.at(2).sample.speed3dKmh).toBe(20);
    expect(timeline.timeAt(1)).toBe(4);
  });
  it('holds a single telemetry sample for the known clip duration', () => {
    const timeline = speedometerTimeline([samples[0]], 12);
    expect(timeline.duration).toBe(12);
    expect(timeline.at(8).sample.speed3dKmh).toBe(0);
  });
  it('rejects telemetry without any usable speed', () => {
    expect(() => speedometerTimeline([{ lat: 0, lon: 0 }], 2)).toThrow(
      /speed/i,
    );
  });
});
