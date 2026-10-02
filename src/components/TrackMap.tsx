import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Clip } from './types';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import { pointPopupHtml } from './pointPopup';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// Let Vite fingerprint and serve MapLibre's worker as a real JS asset.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

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
      maxzoom: 19, // tiles stop at 19; MapLibre overzooms them beyond that
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
  features: clips
    .filter((c) => c.coordinates.length > 1)
    .map((c) => ({
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

// one Point feature per GPS sample (the vertices of the path)
const toPoints = (clips: Clip[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: clips.flatMap((c) =>
    c.coordinates.map((coord, i) => ({
      type: 'Feature' as const,
      properties: {
        clipId: c.id,
        color: c.color,
        i,
        last: i === c.coordinates.length - 1,
      },
      geometry: { type: 'Point' as const, coordinates: coord },
    })),
  ),
});

const toEnds = (clips: Clip[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: clips
    .filter((c) => c.coordinates.length > 1)
    .flatMap((c) =>
      [
        { kind: 'start', i: 0, coord: c.coordinates[0] },
        {
          kind: 'end',
          i: c.coordinates.length - 1,
          coord: c.coordinates[c.coordinates.length - 1],
        },
      ].map((p) => ({
        type: 'Feature' as const,
        properties: { clipId: c.id, i: p.i, color: c.color, kind: p.kind },
        geometry: { type: 'Point' as const, coordinates: p.coord },
      })),
    ),
});

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const POINT_LAYERS = ['points-selected', 'points', 'points-all', 'ends'];
const HIT_PX = 8; // forgiving hover radius around a dot

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
  const data = useRef(clips); // latest clips for the hover handler (it's registered once)

  useEffect(() => {
    cb.current = { onSelect, onHover };
  }, [onSelect, onHover]);

  useEffect(() => {
    data.current = clips;
  }, [clips]);

  // init once
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center: [0, 20], // placeholder; fitted to the data once clips load
      zoom: 1,
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.resize()); // sidebar drag / maximize
    ro.observe(el.current!);
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
      m.addSource('points', { type: 'geojson', data: toPoints([]) });
      m.addSource('ends', { type: 'geojson', data: toEnds([]) });
      m.addSource('hover', { type: 'geojson', data: EMPTY });

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
      // white casing under the coloured line so the path always stands out on the basemap
      m.addLayer({
        id: 'tracks-casing',
        type: 'line',
        source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#fff',
          'line-opacity': 0.9,
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            10,
            8,
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

      // GPS samples. 10 Hz data is far denser than the screen can show, so dots would
      // merge and bury the line. Show every 5th sample (+ the last) from zoom 14, and
      // every sample only when zoomed in close (zoom 20+).
      const thinned: maplibregl.FilterSpecification = [
        'any',
        ['==', ['%', ['get', 'i'], 5], 0],
        ['==', ['get', 'last'], true],
      ];
      const dot = (
        r: number,
        stroke: number,
      ): maplibregl.CircleLayerSpecification['paint'] => ({
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          r * 0.6,
          19,
          r,
        ] as maplibregl.ExpressionSpecification,
        'circle-color': '#fff',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': stroke,
      });
      m.addLayer({
        id: 'points-all',
        type: 'circle',
        source: 'points',
        minzoom: 20,
        paint: dot(2.5, 1.5),
      });
      m.addLayer({
        id: 'points',
        type: 'circle',
        source: 'points',
        minzoom: 14,
        filter: thinned,
        paint: dot(3.5, 2),
      });
      // selected clip's points: larger, on top
      m.addLayer({
        id: 'points-selected',
        type: 'circle',
        source: 'points',
        minzoom: 14,
        filter: ['all', thinned, ['==', ['get', 'clipId'], '']],
        paint: dot(4.5, 2.5),
      });
      m.addLayer({
        id: 'ends',
        type: 'circle',
        source: 'ends',
        paint: {
          'circle-radius': 6,
          // start = hollow (white), end = filled with the route colour
          'circle-color': [
            'case',
            ['==', ['get', 'kind'], 'end'],
            ['get', 'color'],
            '#fff',
          ],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 3,
        },
      });

      // ring around the hovered point, above everything else
      m.addLayer({
        id: 'hover-ring',
        type: 'circle',
        source: 'hover',
        paint: {
          'circle-radius': 8,
          'circle-color': '#fff',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 3.5,
        },
      });

      // hover a point -> bubble with all of its metadata
      const popup = new maplibregl.Popup({
        className: 'ctt-popup',
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        focusAfterOpen: false,
        maxWidth: 'none',
        offset: 14,
      });
      let shown = '';
      const hide = () => {
        if (!shown) return;
        shown = '';
        popup.remove();
        (m.getSource('hover') as GeoJSONSource).setData(EMPTY);
      };
      m.on('mousemove', (e) => {
        const { x, y } = e.point;
        const hits = m.queryRenderedFeatures(
          [
            [x - HIT_PX, y - HIT_PX],
            [x + HIT_PX, y + HIT_PX],
          ],
          { layers: POINT_LAYERS },
        );
        // nearest dot to the cursor wins
        let best: (typeof hits)[number] | undefined;
        let bestD = Infinity;
        for (const f of hits) {
          const p = m.project((f.geometry as Point).coordinates as [number, number]);
          const d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d < bestD) [best, bestD] = [f, d];
        }
        const clipId = best?.properties?.clipId;
        const i = best?.properties?.i;
        if (clipId === undefined || i === undefined) return hide();

        const key = `${clipId}:${i}`;
        if (key === shown) return;
        const clip = data.current.find((c) => c.id === clipId);
        const coord = clip?.coordinates[i];
        if (!clip || !coord || !clip.samples[i]) return hide();

        shown = key;
        popup.setLngLat(coord).setHTML(pointPopupHtml(clip, i)).addTo(m);
        (m.getSource('hover') as GeoJSONSource).setData({
          type: 'Feature',
          properties: { color: clip.color },
          geometry: { type: 'Point', coordinates: coord },
        });
      });
      m.on('mouseout', hide);
      m.on('zoomstart', hide);

      m.on('click', ['points', 'points-all'], (e) => {
        const id = e.features?.[0]?.properties?.clipId;
        if (id) cb.current.onSelect(id);
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

    return () => {
      ro.disconnect();
      m.remove();
    };
  }, []);

  // geometry changes -> setData
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource('tracks') as GeoJSONSource).setData(toTracks(clips));
    (m.getSource('points') as GeoJSONSource).setData(toPoints(clips));
    (m.getSource('ends') as GeoJSONSource).setData(toEnds(clips));
    if (clips.length)
      m.fitBounds(boundsOf(clips.flatMap((c) => c.coordinates)), {
        padding: 60,
        maxZoom: 20,
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
    m.setFilter('points-selected', [
      'all',
      ['any', ['==', ['%', ['get', 'i'], 5], 0], ['==', ['get', 'last'], true]],
      ['==', ['get', 'clipId'], selectedId ?? ''],
    ]);
  }, [clips, selectedId, hoveredId, ready]);

  // camera only moves on intentional selection
  useEffect(() => {
    const m = map.current;
    const clip = clips.find((c) => c.id === selectedId);
    if (!ready || !m || !clip) return;
    m.fitBounds(boundsOf(clip.coordinates), {
      padding: { top: 80, bottom: 80, left: 80, right: 80 },
      duration: 600,
      maxZoom: 20,
    });
  }, [selectedId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="ctt-map" />;
}
