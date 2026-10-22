import { describe, expect, it } from 'vitest';
// Load the installed implementation without type-checking MapLibre's build sources.
const cameraHelperPath =
  '../../node_modules/maplibre-gl/src/geo/projection/camera_helper.ts';
const { cameraForBoxAndBearing } = await import(
  /* @vite-ignore */ cameraHelperPath
);
import { LngLatBounds } from 'maplibre-gl';
import { fitTrackBounds } from './fitTrackBounds';

const coordinates: [number, number][] = [
  [20, 40],
  [21, 41],
];
function fixture(width: number, height: number, bottom = 0) {
  const transform = {
    width,
    height,
    worldSize: 512,
    scale: 1,
    padding: { top: 0, left: 0, right: 0, bottom },
  };
  let fitted = false;
  const map = {
    resize() {},
    getContainer: () => ({ clientWidth: width, clientHeight: height }),
    getPadding: () => transform.padding,
    fitBounds(
      bounds: LngLatBounds,
      options: { padding: number; maxZoom?: number },
    ) {
      const p = options.padding;
      const camera = cameraForBoxAndBearing(
        { offset: [0, 0], maxZoom: 15, ...options },
        { top: p, bottom: p, left: p, right: p },
        bounds,
        0,
        transform as never,
      );
      expect(camera).toBeDefined();
      expect(Number.isFinite(camera.center.lng)).toBe(true);
      expect(Number.isFinite(camera.center.lat)).toBe(true);
      expect(Number.isFinite(camera.zoom)).toBe(true);
      fitted = true;
    },
  };
  return { map, fitted: () => fitted };
}
describe('fitTrackBounds', () => {
  it.each([
    [800, 200, 0],
    [200, 600, 0],
    [800, 400, 200],
  ])(
    'fits finite coordinates with a %i × %i map and %i bottom inset',
    (width, height, bottom) => {
      const { map, fitted } = fixture(width, height, bottom);
      fitTrackBounds(map as never, coordinates, { padding: 100 });
      expect(fitted()).toBe(true);
    },
  );
  it('skips a hidden map', () => {
    const { map, fitted } = fixture(0, 0);
    fitTrackBounds(map as never, coordinates, { padding: 100 });
    expect(fitted()).toBe(false);
  });
});
