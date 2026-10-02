import { useEffect, useState } from 'react';
import type { Clip } from './lib/discovery';
import {
  buildExportBlob,
  CSV_COLUMN_LABELS,
  DEFAULT_CSV_COLUMNS,
  downloadExport,
  exportFilename,
  type CsvColumn,
  type ExportFormat,
  type RouteExportSource,
} from './lib/exports';
import { createMp4WorkerClient } from './lib/mp4/client';
import type { MovieInfo } from './lib/mp4/parser';

interface ExportPanelProps {
  clip: Clip;
  savePickerAvailable: boolean;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  gpx: 'GPX',
  csv: 'CSV',
  geojson: 'GeoJSON',
  json: 'JSON',
};

export default function ExportPanel({
  clip,
  savePickerAvailable,
}: ExportPanelProps) {
  const [movie, setMovie] = useState<MovieInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteExportSource>('raw');
  const [columns, setColumns] = useState<CsvColumn[]>(DEFAULT_CSV_COLUMNS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const source = clip.telemetrySource;
    if (!source) return;

    let cancelled = false;
    const operation = client.parse(source.file, (value) => {
      if (!cancelled) setProgress(value);
    });
    operation.result
      .then((result) => {
        if (!cancelled) setMovie(result);
      })
      .catch((reason: { code?: string; message?: string }) => {
        if (cancelled || reason.code === 'CANCELLED') return;
        setError(
          reason.message ?? 'Telemetry could not be decoded for export.',
        );
      });

    return () => {
      cancelled = true;
      operation.cancel();
    };
  }, [client, clip.telemetrySource]);

  function toggleColumn(column: CsvColumn) {
    setColumns((current) =>
      current.includes(column)
        ? current.filter((item) => item !== column)
        : DEFAULT_CSV_COLUMNS.filter(
            (item) => item === column || current.includes(item),
          ),
    );
  }

  async function exportFormat(format: ExportFormat) {
    if (!movie) return;
    setBusy(true);
    try {
      const blob =
        format === 'json'
          ? buildExportBlob('json', movie.route, {
              telemetry: movie.telemetry,
              analysis: movie.route,
              sourceMetadata: {
                clip: clip.name,
                sourceName: movie.sourceName,
                files: clip.files.map((source) => ({
                  name: source.file.name,
                  size: source.file.size,
                  path: source.path,
                })),
                camera: movie.metadata,
              },
            })
          : buildExportBlob(format, movie.route, { route, columns });
      await downloadExport(blob, exportFilename(clip.name, format));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The export could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  const missingSource = !clip.telemetrySource;
  const ready = Boolean(movie) && !busy && !missingSource;
  const readyLabel = missingSource
    ? 'No telemetry source is available for export.'
    : movie
      ? `${movie.route.rawRoute.length} GPS points ready`
      : error
        ? 'Export unavailable'
        : `Reading telemetry… ${Math.round(progress * 100)}%`;

  return (
    <section
      className="export-panel"
      data-testid="export-panel"
      aria-label="Export"
    >
      <div className="export-heading">
        <h4>Export</h4>
        <p>{readyLabel}</p>
      </div>
      <fieldset className="export-route" disabled={!ready}>
        <legend>GPS source</legend>
        <label>
          <input
            type="radio"
            name={`route-${clip.id}`}
            checked={route === 'raw'}
            onChange={() => setRoute('raw')}
          />
          Raw
        </label>
        <label>
          <input
            type="radio"
            name={`route-${clip.id}`}
            checked={route === 'processed'}
            onChange={() => setRoute('processed')}
          />
          Processed
        </label>
      </fieldset>
      <fieldset className="export-columns" disabled={!ready}>
        <legend>CSV columns</legend>
        {DEFAULT_CSV_COLUMNS.map((column) => (
          <label key={column}>
            <input
              type="checkbox"
              checked={columns.includes(column)}
              onChange={() => toggleColumn(column)}
            />
            {CSV_COLUMN_LABELS[column]}
          </label>
        ))}
      </fieldset>
      <div className="export-actions">
        {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((format) => (
          <button
            key={format}
            className="button secondary"
            type="button"
            disabled={!ready || (format === 'csv' && columns.length === 0)}
            onClick={() => void exportFormat(format)}
          >
            {FORMAT_LABELS[format]}
          </button>
        ))}
      </div>
      <p className="export-note">
        {savePickerAvailable
          ? 'A save dialog is available in this browser.'
          : 'Exports download in this browser without a save picker.'}
      </p>
      {error && (
        <p className="export-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
