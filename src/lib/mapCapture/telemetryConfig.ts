import type { GpsPoint } from '../../types';
export type Metric = 'alt' | 'speed';
export type ViewMode = 'graph' | 'dial' | 'readout';
export const metricValue = (p: GpsPoint | undefined, metric: Metric) =>
  metric === 'alt'
    ? p?.altM
    : Number.isFinite(p?.speed3dKmh)
      ? p!.speed3dKmh
      : Number.isFinite(p?.speed3dMs)
        ? p!.speed3dMs! * 3.6
        : undefined;
export function hasTelemetry(
  samples: GpsPoint[],
  metric: Metric,
  mode: ViewMode,
) {
  const count = samples.filter((p) =>
    Number.isFinite(metricValue(p, metric)),
  ).length;
  return (
    count >= (mode === 'graph' || (metric === 'alt' && mode === 'dial') ? 2 : 1)
  );
}
export function telemetryConfig(metric: Metric, mode: ViewMode) {
  const label =
    mode === 'dial'
      ? metric === 'alt'
        ? 'altimeter'
        : 'speedometer'
      : `${metric === 'alt' ? 'altitude' : 'speed'} ${mode === 'graph' ? 'graph' : 'values'}`;
  return {
    label,
    title: label.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    slug: label.replaceAll(' ', '-'),
  };
}
