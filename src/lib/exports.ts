import type {
  DecodedTelemetry,
  GpsPoint,
  UnknownGpmfRecord,
} from './gpmf/types';
import type { RouteAnalysis } from './route';

export type RouteExportSource = 'raw' | 'processed';
export type ExportFormat = 'gpx' | 'csv' | 'geojson' | 'json';
export type CsvColumn =
  | 'time'
  | 'latitude'
  | 'longitude'
  | 'altitude'
  | 'speed2d'
  | 'speed3d'
  | 'dop'
  | 'fix'
  | 'sourceFile'
  | 'sourceSampleIndex';

export interface RouteExportOptions {
  route?: RouteExportSource;
}

export interface CsvExportOptions extends RouteExportOptions {
  columns?: CsvColumn[];
}

export interface FullTelemetryExport {
  telemetry: DecodedTelemetry;
  analysis: RouteAnalysis;
  units?: Record<string, string>;
  sourceMetadata?: unknown;
}

export interface FilePickerHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
}

export type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<FilePickerHandle>;

export interface DownloadEnvironment {
  window: {
    showSaveFilePicker?: SaveFilePicker;
    URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  };
  document: Pick<Document, 'createElement'> & {
    body: { append(node: Node): void };
  };
}

export const DEFAULT_CSV_COLUMNS: CsvColumn[] = [
  'time',
  'latitude',
  'longitude',
  'altitude',
  'speed2d',
  'speed3d',
  'dop',
  'fix',
  'sourceFile',
  'sourceSampleIndex',
];

export const CSV_COLUMN_LABELS: Record<CsvColumn, string> = {
  time: 'Time (UTC)',
  latitude: 'Latitude',
  longitude: 'Longitude',
  altitude: 'Altitude',
  speed2d: 'Speed 2D',
  speed3d: 'Speed 3D',
  dop: 'DOP',
  fix: 'GPS fix',
  sourceFile: 'Source file',
  sourceSampleIndex: 'Source sample',
};

const GPX_TYPE = 'application/gpx+xml;charset=utf-8';
const CSV_TYPE = 'text/csv;charset=utf-8';
const GEOJSON_TYPE = 'application/geo+json;charset=utf-8';
const JSON_TYPE = 'application/json;charset=utf-8';
const EXTENSION_BY_FORMAT: Record<ExportFormat, string> = {
  gpx: 'gpx',
  csv: 'csv',
  geojson: 'geojson',
  json: 'json',
};

function routePoints(
  analysis: RouteAnalysis,
  route: RouteExportSource = 'raw',
) {
  return route === 'raw' ? analysis.rawRoute : analysis.processedRoute;
}

function decimal(value: number | undefined, digits: number) {
  if (!Number.isFinite(value)) return '';
  const factor = 10 ** digits;
  return (
    Math.round((Number(value) + Number.EPSILON) * factor) / factor
  ).toFixed(digits);
}

export function formatUtcTimestamp(point: GpsPoint) {
  if (point.utcTime) {
    const parsed = Date.parse(point.utcTime);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }
  if (
    point.timestampSeconds !== undefined &&
    Number.isFinite(point.timestampSeconds)
  )
    return new Date(point.timestampSeconds * 1_000).toISOString();
  return '';
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function csvValue(value: string | number | undefined) {
  if (value === undefined || value === '') return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvField(point: GpsPoint, column: CsvColumn) {
  switch (column) {
    case 'time':
      return formatUtcTimestamp(point);
    case 'latitude':
      return decimal(point.latitude, 7);
    case 'longitude':
      return decimal(point.longitude, 7);
    case 'altitude':
      return decimal(point.altitude, 3);
    case 'speed2d':
      return decimal(point.speed2d, 3);
    case 'speed3d':
      return decimal(point.speed3d, 3);
    case 'dop':
      return point.dop === undefined ? '' : decimal(point.dop, 3);
    case 'fix':
      return point.fix;
    case 'sourceFile':
      return point.sourceFile;
    case 'sourceSampleIndex':
      return point.sourceSampleIndex;
  }
}

function gpxFix(fix: number | undefined) {
  if (fix === 2) return '2d';
  if (fix === 3) return '3d';
  if (fix === 0 || fix === 1) return 'none';
  return undefined;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function exportFilename(baseName: string, format: ExportFormat) {
  const safe = baseName.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'clip';
  return `${safe}.${EXTENSION_BY_FORMAT[format]}`;
}

export function exportGpx(
  analysis: RouteAnalysis,
  options: RouteExportOptions = {},
) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="ClipToTrack" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:ct="https://cliptotrack.local/schema/export/v1" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <trk>',
    '    <name>ClipToTrack route</name>',
    '    <trkseg>',
  ];

  for (const point of routePoints(analysis, options.route)) {
    lines.push(
      `      <trkpt lat="${decimal(point.latitude, 7)}" lon="${decimal(point.longitude, 7)}">`,
    );
    const elevation = decimal(point.altitude, 3);
    if (elevation) lines.push(`        <ele>${elevation}</ele>`);
    const time = formatUtcTimestamp(point);
    if (time) lines.push(`        <time>${escapeXml(time)}</time>`);
    const fix = gpxFix(point.fix);
    if (fix) lines.push(`        <fix>${fix}</fix>`);
    if (point.dop !== undefined)
      lines.push(`        <hdop>${decimal(point.dop, 3)}</hdop>`);
    const speed = decimal(point.speed2d, 3);
    const quality: string[] = [];
    if (point.fix !== undefined) quality.push(`fix="${point.fix}"`);
    if (point.dop !== undefined) quality.push(`dop="${decimal(point.dop, 3)}"`);
    if (speed || quality.length > 0) {
      lines.push('        <extensions>');
      if (speed) {
        lines.push(
          '          <gpxtpx:TrackPointExtension>',
          `            <gpxtpx:speed>${speed}</gpxtpx:speed>`,
          '          </gpxtpx:TrackPointExtension>',
        );
      }
      if (quality.length > 0)
        lines.push(`          <ct:gps ${quality.join(' ')} />`);
      lines.push('        </extensions>');
    }
    lines.push('      </trkpt>');
  }

  lines.push('    </trkseg>', '  </trk>', '</gpx>');
  return lines.join('\n');
}

export function exportCsv(
  analysis: RouteAnalysis,
  options: CsvExportOptions = {},
) {
  const columns = options.columns ?? DEFAULT_CSV_COLUMNS;
  const rows = [
    columns.join(','),
    ...routePoints(analysis, options.route).map((point) =>
      columns.map((column) => csvValue(csvField(point, column))).join(','),
    ),
  ];
  return rows.join('\n');
}

export function exportGeoJson(
  analysis: RouteAnalysis,
  options: RouteExportOptions = {},
) {
  const route = options.route ?? 'raw';
  const points = routePoints(analysis, route);
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            route,
            pointCount: points.length,
            distanceMeters: Number(
              analysis.statistics.distanceMeters.toFixed(3),
            ),
            durationSeconds: Number(
              analysis.statistics.durationSeconds.toFixed(3),
            ),
            movingTimeSeconds: Number(
              analysis.statistics.movingTimeSeconds.toFixed(3),
            ),
            averageSpeedMps: Number(
              analysis.statistics.averageSpeedMps.toFixed(3),
            ),
            maxSpeedMps: Number(analysis.statistics.maxSpeedMps.toFixed(3)),
            ascentMeters: Number(analysis.statistics.ascentMeters.toFixed(3)),
            descentMeters: Number(analysis.statistics.descentMeters.toFixed(3)),
          },
          geometry: {
            type: 'LineString',
            coordinates: points.map((point) => [
              Number(decimal(point.longitude, 7)),
              Number(decimal(point.latitude, 7)),
              Number(decimal(point.altitude, 3)),
            ]),
          },
        },
      ],
    },
    null,
    2,
  );
}

function serializeUnknownRecord(record: UnknownGpmfRecord) {
  return {
    ...record,
    rawPayload: bytesToBase64(record.rawPayload),
  };
}

export function exportTelemetryJson(input: FullTelemetryExport) {
  const exclusions = input.analysis.rejectedPoints.map((rejection) => ({
    index: rejection.index,
    sourceSampleIndex: rejection.point.sourceSampleIndex,
    reasons: rejection.reasons,
    point: rejection.point,
  }));
  return JSON.stringify(
    {
      version: 1,
      generatedBy: 'ClipToTrack',
      units: input.units ?? {
        distance: 'meters',
        speed: 'meters-per-second',
        elevation: 'meters',
      },
      sourceMetadata: input.sourceMetadata ?? null,
      rawStreams: {
        version: input.telemetry.version,
        streams: input.telemetry.streams,
        gps: input.telemetry.gps,
        unknownRecords: input.telemetry.unknownRecords.map(
          serializeUnknownRecord,
        ),
      },
      routes: {
        raw: input.analysis.rawRoute,
        accepted: input.analysis.acceptedRoute,
        processed: input.analysis.processedRoute,
      },
      statistics: input.analysis.statistics,
      exclusions,
    },
    null,
    2,
  );
}

export function buildExportBlob(
  format: Exclude<ExportFormat, 'json'>,
  analysis: RouteAnalysis,
  options?: RouteExportOptions | CsvExportOptions,
): Blob;
export function buildExportBlob(
  format: 'json',
  analysis: RouteAnalysis,
  options: FullTelemetryExport,
): Blob;
export function buildExportBlob(
  format: ExportFormat,
  analysis: RouteAnalysis,
  options: RouteExportOptions | CsvExportOptions | FullTelemetryExport = {},
) {
  if (format === 'gpx')
    return new Blob([exportGpx(analysis, options as RouteExportOptions)], {
      type: GPX_TYPE,
    });
  if (format === 'csv')
    return new Blob([exportCsv(analysis, options as CsvExportOptions)], {
      type: CSV_TYPE,
    });
  if (format === 'geojson')
    return new Blob([exportGeoJson(analysis, options as RouteExportOptions)], {
      type: GEOJSON_TYPE,
    });
  return new Blob([exportTelemetryJson(options as FullTelemetryExport)], {
    type: JSON_TYPE,
  });
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export async function downloadExport(
  blob: Blob,
  filename: string,
  environment: DownloadEnvironment = {
    window: window as unknown as DownloadEnvironment['window'],
    document,
  },
) {
  const picker = environment.window.showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const mime = blob.type.split(';')[0] || 'application/octet-stream';
      const extension = filename.includes('.')
        ? `.${filename.split('.').pop()}`
        : '';
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: 'ClipToTrack export',
            accept: { [mime]: extension ? [extension] : [] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (isAbortError(error)) return;
    }
  }

  const url = environment.window.URL.createObjectURL(blob);
  const anchor = environment.document.createElement('a') as HTMLAnchorElement;
  anchor.href = url;
  anchor.download = filename;
  environment.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  environment.window.URL.revokeObjectURL(url);
}
