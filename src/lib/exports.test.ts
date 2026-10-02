import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DecodedTelemetry, GpsPoint } from './gpmf/types';
import { parseMp4 } from './mp4/parser';
import { buildRouteAnalysis } from './route';
import {
  buildExportBlob,
  downloadExport,
  exportCsv,
  exportFilename,
  exportGeoJson,
  exportGpx,
  exportTelemetryJson,
  type CsvColumn,
} from './exports';

const point = (
  overrides: Partial<GpsPoint> & Pick<GpsPoint, 'utcTime'>,
): GpsPoint => ({
  latitude: 47.2899587,
  longitude: 12.6970259,
  altitude: 792.12345,
  speed2d: 5.6789,
  speed3d: 6.789,
  dop: 1.2345,
  fix: 3,
  sourceFile: 'GL010753.LRV',
  sourceSampleIndex: 0,
  ...overrides,
});

function telemetry(): DecodedTelemetry {
  return {
    version: 1,
    gps: [
      point({ utcTime: '2026-09-21T08:36:35.300Z' }),
      point({
        utcTime: '2026-09-21T08:36:36.300Z',
        latitude: 47.29,
        longitude: 12.6971,
        altitude: 793,
        sourceSampleIndex: 1,
      }),
    ],
    streams: [
      {
        key: 'ACCL',
        name: 'Accelerometer',
        category: 'motion',
        type: 'f',
        units: ['m/s2'],
        siUnits: ['m/s2'],
        scale: [1],
        sourceSampleIndex: 0,
        values: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        samples: [
          {
            timestampSeconds: 0.1,
            values: [1, 2, 3],
            rawValues: [100, 200, 300],
          },
        ],
      },
    ],
    unknownRecords: [
      {
        key: 'ZZZZ',
        type: 'B',
        structSize: 1,
        repeat: 4,
        sourceSampleIndex: 9,
        rawPayload: new Uint8Array([222, 173, 190, 239]),
      },
    ],
  };
}

function gpx11Issues(xml: string) {
  const issues: string[] = [];
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
    issues.push('missing XML declaration');
  if (!xml.includes('xmlns="http://www.topografix.com/GPX/1/1"'))
    issues.push('missing GPX 1.1 namespace');
  if (!/version="1.1"/.test(xml)) issues.push('missing GPX version 1.1');
  if (
    !xml.includes(
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd"',
    )
  )
    issues.push('missing GPX 1.1 schemaLocation');
  if (/<time>\s*<\/time>/.test(xml)) issues.push('empty time element');
  for (const match of xml.matchAll(
    /<trkpt lat="([^"]+)" lon="([^"]+)">([\s\S]*?)<\/trkpt>/g,
  )) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (!(latitude >= -90 && latitude <= 90))
      issues.push('latitude out of range');
    if (!(longitude >= -180 && longitude <= 180))
      issues.push('longitude out of range');
    const body = match[3];
    const time = body.match(/<time>([^<]+)<\/time>/)?.[1];
    if (time && Number.isNaN(Date.parse(time)))
      issues.push(`invalid time ${time}`);
    const fix = body.match(/<fix>([^<]+)<\/fix>/)?.[1];
    if (fix && !['none', '2d', '3d', 'dgps', 'pps'].includes(fix))
      issues.push(`invalid fix ${fix}`);
  }
  return issues;
}

describe('export formats', () => {
  it('exports deterministic GPX 1.1 with elevation, speed, and GPS quality extensions', () => {
    const analysis = buildRouteAnalysis(telemetry().gps);
    const xml = exportGpx(analysis);

    expect(gpx11Issues(xml)).toEqual([]);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="ClipToTrack" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:ct="https://cliptotrack.local/schema/export/v1" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
        '  <trk>',
        '    <name>ClipToTrack route</name>',
        '    <trkseg>',
        '      <trkpt lat="47.2899587" lon="12.6970259">',
        '        <ele>792.123</ele>',
        '        <time>2026-09-21T08:36:35.300Z</time>',
        '        <fix>3d</fix>',
        '        <hdop>1.235</hdop>',
        '        <extensions>',
        '          <gpxtpx:TrackPointExtension>',
        '            <gpxtpx:speed>5.679</gpxtpx:speed>',
        '          </gpxtpx:TrackPointExtension>',
        '          <ct:gps fix="3" dop="1.235" />',
        '        </extensions>',
        '      </trkpt>',
        '      <trkpt lat="47.2900000" lon="12.6971000">',
        '        <ele>793.000</ele>',
        '        <time>2026-09-21T08:36:36.300Z</time>',
        '        <fix>3d</fix>',
        '        <hdop>1.235</hdop>',
        '        <extensions>',
        '          <gpxtpx:TrackPointExtension>',
        '            <gpxtpx:speed>5.679</gpxtpx:speed>',
        '          </gpxtpx:TrackPointExtension>',
        '          <ct:gps fix="3" dop="1.235" />',
        '        </extensions>',
        '      </trkpt>',
        '    </trkseg>',
        '  </trk>',
        '</gpx>',
      ].join('\n'),
    );
  });

  it('keeps CSV headers aligned with configurable optional fields', () => {
    const analysis = buildRouteAnalysis([
      point({ utcTime: '2026-09-21T08:36:35.300Z', dop: undefined }),
      point({
        utcTime: '2026-09-21T08:36:36.300Z',
        latitude: 47.29,
        longitude: 12.6971,
        altitude: 793,
        sourceFile: undefined,
        sourceSampleIndex: 1,
      }),
    ]);
    const columns: CsvColumn[] = [
      'time',
      'latitude',
      'longitude',
      'speed2d',
      'dop',
      'fix',
      'sourceFile',
    ];

    expect(exportCsv(analysis, { columns })).toBe(
      [
        'time,latitude,longitude,speed2d,dop,fix,sourceFile',
        '2026-09-21T08:36:35.300Z,47.2899587,12.6970259,5.679,,3,GL010753.LRV',
        '2026-09-21T08:36:36.300Z,47.2900000,12.6971000,5.679,1.235,3,',
      ].join('\n'),
    );
  });

  it('exports GeoJSON with route geometry and summary properties', () => {
    const analysis = buildRouteAnalysis(telemetry().gps);
    const geoJson = JSON.parse(exportGeoJson(analysis));

    expect(geoJson).toMatchObject({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [12.6970259, 47.2899587, 792.123],
              [12.6971, 47.29, 793],
            ],
          },
        },
      ],
    });
    expect(geoJson.features[0].properties).toMatchObject({
      pointCount: 2,
      route: 'raw',
      distanceMeters: expect.any(Number),
      durationSeconds: 1,
    });
  });

  it('uses processed GPS only when that route is requested', () => {
    const analysis = buildRouteAnalysis(telemetry().gps, {
      smoothing: { enabled: true, smoothingFactor: 0.9 },
    });
    const raw = JSON.parse(exportGeoJson(analysis, { route: 'raw' }));
    const processed = JSON.parse(
      exportGeoJson(analysis, { route: 'processed' }),
    );

    expect(raw.features[0].properties.route).toBe('raw');
    expect(processed.features[0].properties.route).toBe('processed');
    expect(processed.features[0].geometry.coordinates).not.toEqual(
      raw.features[0].geometry.coordinates,
    );
  });

  it('exports versioned JSON retaining telemetry streams, unknown records, metadata, and exclusions', () => {
    const decoded = telemetry();
    decoded.gps[0] = { ...decoded.gps[0], fix: 0 };
    const analysis = buildRouteAnalysis(decoded.gps);
    const exported = JSON.parse(
      exportTelemetryJson({
        telemetry: decoded,
        analysis,
        sourceMetadata: { files: [{ name: 'GL010753.LRV', size: 123 }] },
        units: { distance: 'meters', speed: 'meters-per-second' },
      }),
    );

    expect(exported).toMatchObject({
      version: 1,
      units: { distance: 'meters', speed: 'meters-per-second' },
      sourceMetadata: { files: [{ name: 'GL010753.LRV', size: 123 }] },
      rawStreams: {
        streams: decoded.streams,
        gps: decoded.gps,
      },
      routes: {
        raw: decoded.gps,
        processed: analysis.processedRoute,
      },
    });
    expect(exported.exclusions[0].reasons).toContain('gps-fix-too-low');
    expect(exported.rawStreams.unknownRecords[0].rawPayload).toBe('3q2+7w==');
  });

  it('formats timestamps in UTC regardless of the local timezone', () => {
    const analysis = buildRouteAnalysis([
      point({ utcTime: '2026-09-21T08:36:35.300Z' }),
    ]);
    expect(exportGpx(analysis)).toContain(
      '<time>2026-09-21T08:36:35.300Z</time>',
    );
    expect(exportCsv(analysis)).toContain('2026-09-21T08:36:35.300Z');
  });

  it('creates typed Blob objects and falls back to browser downloads without the File System Access API', async () => {
    const analysis = buildRouteAnalysis(telemetry().gps);
    const blob = buildExportBlob('gpx', analysis);
    const createObjectURL = vi.fn(() => 'blob:cliptotrack');
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const anchor = {
      href: '',
      download: '',
      click,
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement;
    const documentLike = {
      createElement: vi.fn(() => anchor),
      body: { append: vi.fn() },
    };

    await downloadExport(blob, exportFilename('G010753', 'gpx'), {
      window: { URL: { createObjectURL, revokeObjectURL } },
      document: documentLike,
    });

    expect(blob.type).toBe('application/gpx+xml;charset=utf-8');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.download).toBe('G010753.gpx');
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cliptotrack');
  });

  it('uses showSaveFilePicker when the File System Access API is available', async () => {
    const analysis = buildRouteAnalysis(telemetry().gps);
    const blob = buildExportBlob('csv', analysis, { route: 'raw' });
    const write = vi.fn();
    const close = vi.fn();
    const picker = vi.fn(async () => ({
      createWritable: async () => ({ write, close }),
    }));
    const createObjectURL = vi.fn();

    await downloadExport(blob, 'route.csv', {
      window: {
        showSaveFilePicker: picker,
        URL: { createObjectURL, revokeObjectURL: vi.fn() },
      },
      document: { createElement: vi.fn(), body: { append: vi.fn() } },
    });

    expect(picker).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('exports 65 GPX points and complete JSON from the supplied raw route', async () => {
    const content = await readFile(resolve('asset', 'GL010753.LRV'));
    const result = await parseMp4(new File([content], 'GL010753.LRV'));
    const xml = exportGpx(result.route, { route: 'raw' });
    const json = JSON.parse(
      exportTelemetryJson({
        telemetry: result.telemetry,
        analysis: result.route,
        sourceMetadata: result.metadata,
      }),
    );
    const geoJson = JSON.parse(exportGeoJson(result.route, { route: 'raw' }));

    expect(gpx11Issues(xml)).toEqual([]);
    expect([...xml.matchAll(/<trkpt /g)]).toHaveLength(65);
    expect(json.rawStreams.gps).toHaveLength(65);
    expect(
      json.rawStreams.streams.some(
        (stream: { key: string }) => stream.key === 'ACCL',
      ),
    ).toBe(true);
    expect(json.rawStreams.unknownRecords.length).toBeGreaterThan(0);
    expect(json.rawStreams.unknownRecords[0].rawPayload).toMatch(
      /^[A-Za-z0-9+/]+=*$/,
    );
    expect(geoJson.features[0].geometry.coordinates).toHaveLength(65);
    expect(geoJson.features[0].geometry.type).toBe('LineString');
  });
});
