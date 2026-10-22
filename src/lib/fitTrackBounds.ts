import { LngLatBounds, type Map, type FitBoundsOptions } from 'maplibre-gl';

export function fitTrackBounds(
  map: Map,
  coordinates: [number, number][],
  options: FitBoundsOptions & { padding: number },
) {
  if (!coordinates.length) return;
  // ResizeObserver may not have run yet after a layout change.
  map.resize();
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  const inset = map.getPadding();
  const available = Math.min(
    width - (inset.left ?? 0) - (inset.right ?? 0),
    height - (inset.top ?? 0) - (inset.bottom ?? 0),
  );
  if (available <= 0) return;
  // MapLibre computes an infinite scale at zero available space; its center
  // calculation then multiplies zero by infinity and throws for (NaN, NaN).
  const padding = Math.min(options.padding, available / 4);
  map.fitBounds(
    coordinates.reduce(
      (bounds, point) => bounds.extend(point),
      new LngLatBounds(),
    ),
    { ...options, padding },
  );
}
