import type { Clip } from './types';

const x = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function clipToGpx(clip: Clip): string {
  const pts = clip.samples
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lon}">${p.altM !== undefined ? `<ele>${p.altM}</ele>` : ''}${p.utc ? `<time>${p.utc}</time>` : ''}</trkpt>`,
    )
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="clip to track" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${x(clip.title)}</name><trkseg>
      ${pts}
  </trkseg></trk>
</gpx>`;
}

export function clipToGeoJson(clip: Clip): string {
  return JSON.stringify(
    {
      type: 'Feature',
      properties: {
        title: clip.title,
        date: clip.date,
        distance: clip.distance,
        maxSpeed: clip.maxSpeed,
        altitude: clip.altitude,
      },
      geometry: {
        type: 'LineString',
        coordinates: clip.samples.map((p) =>
          p.altM !== undefined ? [p.lon, p.lat, p.altM] : [p.lon, p.lat],
        ),
      },
    },
    null,
    2,
  );
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
