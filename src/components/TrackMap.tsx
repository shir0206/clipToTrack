import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Clip } from './data';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';

type Props = {
  clips: Clip[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

// Quiet raster basemap, no API key. Swap for your own style URL.
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.9 },
    },
  ],
};

const toTracks = (clips: Clip[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: clips.map((c) => ({
    type: 'Feature',
    properties: {
      clipId: c.id,
      index: c.index,
      title: c.title,
      color: c.color,
    },
    geometry: { type: 'LineString', coordinates: c.coordinates },
  })),
});

const toEnds = (clips: Clip[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: clips.flatMap((c) =>
    [
      { kind: 'start', coord: c.coordinates[0] },
      { kind: 'end', coord: c.coordinates[c.coordinates.length - 1] },
    ].map((p) => ({
      type: 'Feature' as const,
      properties: { color: c.color, kind: p.kind },
      geometry: { type: 'Point' as const, coordinates: p.coord },
    })),
  ),
});

const boundsOf = (coords: [number, number][]) =>
  coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );

export default function TrackMap({
  clips,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef({ onSelect, onHover });
  cb.current = { onSelect, onHover };

  // init once
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center: [7.84, 46.1],
      zoom: 11,
    });
    map.current = m;
    m.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    );

    m.on('load', () => {
      m.addSource('tracks', {
        type: 'geojson',
        data: toTracks([]),
        promoteId: 'clipId',
      });
      m.addSource('ends', { type: 'geojson', data: toEnds([]) });

      m.addLayer({
        id: 'tracks-glow',
        type: 'line',
        source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 14,
          'line-blur': 8,
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.45,
            ['boolean', ['feature-state', 'hovered'], false],
            0.25,
            0,
          ],
        },
      });
      m.addLayer({
        id: 'tracks-line',
        type: 'line',
        source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            6,
            4,
          ],
        },
      });
      m.addLayer({
        id: 'ends',
        type: 'circle',
        source: 'ends',
        paint: {
          'circle-radius': 6,
          'circle-color': '#fff',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 3,
        },
      });

      m.on('click', 'tracks-line', (e) => {
        const id = e.features?.[0]?.properties?.clipId;
        if (id) cb.current.onSelect(id);
      });
      m.on('mousemove', 'tracks-line', (e) => {
        m.getCanvas().style.cursor = 'pointer';
        cb.current.onHover(e.features?.[0]?.properties?.clipId ?? null);
      });
      m.on('mouseleave', 'tracks-line', () => {
        m.getCanvas().style.cursor = '';
        cb.current.onHover(null);
      });
      setReady(true);
    });

    return () => m.remove();
  }, []);

  // geometry changes -> setData
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource('tracks') as GeoJSONSource).setData(toTracks(clips));
    (m.getSource('ends') as GeoJSONSource).setData(toEnds(clips));
    if (clips.length)
      m.fitBounds(boundsOf(clips.flatMap((c) => c.coordinates)), {
        padding: 60,
        duration: 0,
      });
  }, [clips, ready]);

  // interaction state -> feature-state
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    clips.forEach((c) =>
      m.setFeatureState(
        { source: 'tracks', id: c.id },
        { selected: c.id === selectedId, hovered: c.id === hoveredId },
      ),
    );
  }, [clips, selectedId, hoveredId, ready]);

  // camera only moves on intentional selection
  useEffect(() => {
    const m = map.current;
    const clip = clips.find((c) => c.id === selectedId);
    if (!ready || !m || !clip) return;
    m.fitBounds(boundsOf(clip.coordinates), {
      padding: { top: 80, bottom: 80, left: 80, right: 80 },
      duration: 600,
    });
  }, [selectedId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="ctt-map" />;
}
