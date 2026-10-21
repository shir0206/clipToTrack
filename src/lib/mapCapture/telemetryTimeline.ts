import type { GpsPoint } from '../../types';

/** Export time is independent of wall-clock time and encoder throughput. */
export function telemetryTimeline(samples: GpsPoint[], duration: number) {
  if (
    !samples.some((p) =>
      [p.altM, p.speed3dKmh, p.speed3dMs].some(Number.isFinite),
    )
  )
    throw new Error('Select a clip with usable telemetry.');
  const first = Date.parse(samples[0]?.utc ?? '');
  const utc = samples.map((p) => (Date.parse(p.utc ?? '') - first) / 1000);
  const valid = utc.every(
    (t, i) => Number.isFinite(t) && (i === 0 || t > utc[i - 1]),
  );
  const times =
    valid && utc.at(-1)! > 0
      ? utc
      : samples.map(
          (_, i) =>
            (i * Math.max(duration, 0.04)) / Math.max(1, samples.length - 1),
        );
  return {
    duration: Math.max(
      0.04,
      samples.length === 1 ? duration : (times.at(-1) ?? duration),
    ),
    timeAt: (index: number) =>
      times[Math.max(0, Math.min(samples.length - 1, index))] ?? 0,
    at(time: number) {
      let lo = 0;
      let hi = times.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (times[mid] <= time) lo = mid;
        else hi = mid - 1;
      }
      const a = samples[lo];
      const b = samples[Math.min(lo + 1, samples.length - 1)];
      const fraction = Math.max(
        0,
        Math.min(1, (time - times[lo]) / (times[lo + 1] - times[lo]) || 0),
      );
      const sample = { ...a };
      for (const key of [
        'lat',
        'lon',
        'altM',
        'speed3dKmh',
        'speed3dMs',
        'cumulativeDistM',
      ] as const) {
        if (Number.isFinite(a[key]) && Number.isFinite(b[key]))
          sample[key] = a[key]! + (b[key]! - a[key]!) * fraction;
      }
      return { sample, probe: lo };
    },
  };
}
