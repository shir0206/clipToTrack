import { describe, expect, it } from 'vitest';
import { getLandscapeFrame, toCanvasCrop } from './captureGeometry';

describe('map capture geometry', () => {
  it.each([
    [1600, 900],
    [1200, 1200],
    [390, 700],
    [2000, 500],
  ])('centers a contained 16:9 frame in %s × %s', (width, height) => {
    const frame = getLandscapeFrame(width, height);
    expect(frame.width / frame.height).toBeCloseTo(16 / 9);
    expect(frame.x * 2 + frame.width).toBeCloseTo(width);
    expect(frame.y * 2 + frame.height).toBeCloseTo(height);
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
  });
  it('maps a CSS frame precisely into a high-DPI backing canvas', () => {
    expect(
      toCanvasCrop(
        { x: 20, y: 50, width: 320, height: 180 },
        400,
        300,
        1200,
        900,
      ),
    ).toEqual({ x: 60, y: 150, width: 960, height: 540 });
  });
  it('clamps partly excluded edges without reading outside the canvas', () => {
    expect(
      toCanvasCrop(
        { x: -10, y: -20, width: 120, height: 140 },
        100,
        100,
        200,
        200,
      ),
    ).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid dimensions: %s', (value) => {
    expect(() => getLandscapeFrame(value, 100)).toThrow(RangeError);
    expect(() =>
      toCanvasCrop(
        { x: 0, y: 0, width: 100, height: 100 },
        100,
        value,
        200,
        200,
      ),
    ).toThrow(RangeError);
  });
  it('rejects nonfinite positions and entirely excluded frames', () => {
    for (const x of [NaN, Infinity, 101])
      expect(() =>
        toCanvasCrop({ x, y: 0, width: 10, height: 10 }, 100, 100, 100, 100),
      ).toThrow(RangeError);
  });
});
