import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GpsPoint } from './gpmf/types';
import { parseMp4 } from './mp4/parser';
import { buildRouteAnalysis } from './route';

const point = (
  overrides: Partial<GpsPoint> & Pick<GpsPoint, 'utcTime'>,
): GpsPoint => ({
  latitude: 47.2899587,
  longitude: 12.6970259,
  altitude: 792,
  speed2d: 5,
  speed3d: 5,
  dop: 1.37,
  fix: 3,
  sourceSampleIndex: 0,
  ...overrides,
});

describe('route analysis', () => {
  it('preserves the decoded raw route while deriving accepted and processed routes', () => {
    const raw = [
      point({ utcTime: '2026-09-21T08:36:35.300Z' }),
      point({
        utcTime: '2026-09-21T08:36:35.400Z',
        latitude: 47.28997,
        longitude: 12.69704,
      }),
    ];

    const analysis = buildRouteAnalysis(raw, {
      smoothing: { enabled: true, smoothingFactor: 0.25 },
    });

    expect(analysis.rawRoute).toEqual(raw);
    expect(analysis.acceptedRoute).not.toBe(raw);
    expect(analysis.processedRoute).not.toEqual(analysis.rawRoute);
    expect(raw[1].latitude).toBe(47.28997);
  });

  it('filters invalid points and records every rejection reason', () => {
    const raw = [
      point({ utcTime: '2026-09-21T08:36:35.000Z', fix: 0 }),
      point({
        utcTime: '2026-09-21T08:36:35.050Z',
        fix: undefined,
        sourceSampleIndex: 6,
      }),
      point({
        utcTime: undefined,
        timestampSeconds: Number.NaN,
        sourceSampleIndex: 7,
      }),
      point({
        utcTime: '2026-09-21T08:36:35.100Z',
        dop: 10,
        sourceSampleIndex: 1,
      }),
      point({
        utcTime: '2026-09-21T08:36:35.200Z',
        latitude: 91,
        sourceSampleIndex: 2,
      }),
      point({ utcTime: '2026-09-21T08:36:35.300Z', sourceSampleIndex: 3 }),
      point({
        utcTime: '2026-09-21T08:36:35.300Z',
        sourceSampleIndex: 4,
      }),
      point({
        utcTime: '2026-09-21T08:36:35.400Z',
        latitude: 48,
        longitude: 13,
        sourceSampleIndex: 5,
      }),
    ];

    const analysis = buildRouteAnalysis(raw, {
      minFix: 2,
      maxDop: 3,
      maxJumpSpeedMps: 100,
    });

    expect(analysis.acceptedRoute).toHaveLength(1);
    expect(analysis.rejectedPoints.map((point) => point.reasons)).toEqual([
      ['gps-fix-too-low'],
      ['gps-fix-too-low'],
      ['invalid-timestamp'],
      ['dop-too-high'],
      ['latitude-out-of-range'],
      ['duplicate-timestamp'],
      ['impossible-jump'],
    ]);
  });

  it('calculates geodesic distance, timing, speeds, ascent, and descent', () => {
    const analysis = buildRouteAnalysis([
      point({
        utcTime: '2026-09-21T08:36:35.000Z',
        altitude: 100,
        speed2d: 0.5,
      }),
      point({
        utcTime: '2026-09-21T08:36:36.000Z',
        latitude: 47.29,
        longitude: 12.6972,
        altitude: 105,
        speed2d: 6,
      }),
      point({
        utcTime: '2026-09-21T08:36:38.000Z',
        latitude: 47.2901,
        longitude: 12.6974,
        altitude: 103,
        speed2d: 8,
      }),
    ]);

    expect(analysis.statistics.distanceMeters).toBeGreaterThan(30);
    expect(analysis.statistics.durationSeconds).toBe(3);
    expect(analysis.statistics.movingTimeSeconds).toBe(3);
    expect(analysis.statistics.averageSpeedMps).toBeCloseTo(
      analysis.statistics.distanceMeters / 3,
    );
    expect(analysis.statistics.maxSpeedMps).toBe(8);
    expect(analysis.statistics.ascentMeters).toBe(5);
    expect(analysis.statistics.descentMeters).toBe(2);
  });

  it('keeps stationary jitter stable with optional time-aware smoothing', () => {
    const raw = [
      point({ utcTime: '2026-09-21T08:36:35.000Z', speed2d: 0, speed3d: 0 }),
      point({
        utcTime: '2026-09-21T08:36:36.000Z',
        latitude: 47.2899687,
        longitude: 12.6970159,
        speed2d: 0,
        speed3d: 0,
      }),
      point({
        utcTime: '2026-09-21T08:36:37.000Z',
        latitude: 47.2899487,
        longitude: 12.6970359,
        speed2d: 0,
        speed3d: 0,
      }),
    ];

    const rawAnalysis = buildRouteAnalysis(raw);
    const smoothed = buildRouteAnalysis(raw, {
      smoothing: { enabled: true, smoothingFactor: 0.1 },
    });

    expect(rawAnalysis.processedRoute).toEqual(rawAnalysis.acceptedRoute);
    expect(smoothed.processedRoute[1].latitude).toBeCloseTo(raw[0].latitude, 5);
    expect(smoothed.processedRoute[2].longitude).toBeCloseTo(
      raw[0].longitude,
      5,
    );
    expect(raw).toEqual(rawAnalysis.rawRoute);
  });

  it('smooths across the dateline using the shortest longitude path', () => {
    const raw = [
      point({
        utcTime: '2026-09-21T08:36:35.000Z',
        latitude: 0,
        longitude: 179.99999,
        speed2d: 2,
        speed3d: 2,
      }),
      point({
        utcTime: '2026-09-21T08:36:36.000Z',
        latitude: 0,
        longitude: -179.99999,
        speed2d: 2,
        speed3d: 2,
      }),
    ];

    const analysis = buildRouteAnalysis(raw, {
      smoothing: { enabled: true },
    });

    expect(Math.abs(analysis.processedRoute[1].longitude)).toBeGreaterThan(
      179.9999,
    );
  });

  it('handles time gaps without over-smoothing later valid movement', () => {
    const raw = [
      point({ utcTime: '2026-09-21T08:36:35.000Z' }),
      point({
        utcTime: '2026-09-21T08:36:50.000Z',
        latitude: 47.2905,
        longitude: 12.6978,
      }),
    ];

    const analysis = buildRouteAnalysis(raw, {
      smoothing: {
        enabled: true,
        smoothingFactor: 0.05,
        resetGapSeconds: 10,
      },
    });

    expect(analysis.processedRoute[1]).toMatchObject({
      latitude: raw[1].latitude,
      longitude: raw[1].longitude,
    });
  });

  it('matches the reference HERO13 route quality and statistics', async () => {
    const content = await readFile(resolve('asset', 'GL010753.LRV'));
    const result = await parseMp4(new File([content], 'GL010753.LRV'));

    const analysis = buildRouteAnalysis(result.telemetry.gps);

    expect(analysis.rawRoute).toHaveLength(65);
    expect(analysis.acceptedRoute).toHaveLength(65);
    expect(analysis.rejectedPoints).toHaveLength(0);
    expect(analysis.statistics.durationSeconds).toBeCloseTo(6.4, 5);
    expect(analysis.statistics.distanceMeters).toBeCloseTo(46.71, 0);
    expect(analysis.statistics.maxSpeedKph).toBeCloseTo(38.25, 1);
  });
});
