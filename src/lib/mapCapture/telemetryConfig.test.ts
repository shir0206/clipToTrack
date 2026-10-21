import { describe, expect, it } from 'vitest';
import {
  telemetryConfig,
  hasTelemetry,
  type Metric,
  type ViewMode,
} from './telemetryConfig';

describe('telemetry recording targets', () => {
  for (const metric of ['alt', 'speed'] as Metric[]) {
    for (const mode of ['graph', 'dial', 'readout'] as ViewMode[]) {
      it(`configures ${metric} ${mode} from the selected view`, () => {
        const config = telemetryConfig(metric, mode);
        expect(config.label).toContain(
          mode === 'dial'
            ? metric === 'alt'
              ? 'altimeter'
              : 'speedometer'
            : metric === 'alt'
              ? 'altitude'
              : 'speed',
        );
        expect(config.slug).not.toMatch(/\s/);
      });
    }
  }
  it('enables altitude recording without speed telemetry', () => {
    const samples = [
      { lat: 0, lon: 0, altM: 100 },
      { lat: 0, lon: 0, altM: 120 },
    ];
    expect(hasTelemetry(samples, 'alt', 'dial')).toBe(true);
    expect(hasTelemetry(samples, 'speed', 'dial')).toBe(false);
  });
  it('requires enough finite points to plot a graph', () => {
    expect(hasTelemetry([{ lat: 0, lon: 0, altM: 100 }], 'alt', 'graph')).toBe(
      false,
    );
  });
});
