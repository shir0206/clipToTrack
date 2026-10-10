import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { createPortal } from 'react-dom';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Clip } from '../../types';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { pointPopupHtml } from '../../lib/pointPopup';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import MapPanel, {
  loadOpts,
  saveOpts,
  type BaseKey,
  type MapOpts,
} from '../MapPanel/MapPanel';
import ElevationProfile from '../ElevationProfile/ElevationProfile';
import Icon from '../Icon/Icon';
import { COPYRIGHT_OWNER } from '../../config/copyright';
import './TrackMap.css';
import { useSettings } from '../../lib/settings';
import { clipToGeoJson, clipToGpx, download } from '../../lib/exportTrack';

// Let Vite fingerprint and serve MapLibre's worker as a real JS asset.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

/** Imperative handle for per-frame updates that shouldn't re-render React (video playhead). */
export type MapApi = {
  setPlayhead: (clipId: string, frac: number | null) => void;
};

type Props = {
  clips: Clip[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  apiRef?: MutableRefObject<MapApi | null>;
  /** phone layouts: compact toolbar, touch hit areas, no hover popups */
  compact?: boolean;
  /** px of the map covered at the bottom by the sheet (camera padding) */
  insetBottom?: number;
  /** phone: the elevation / speed dock is portalled into the sheet instead of sitting under the map */
  profileHost?: HTMLElement | null;
  /** tap on empty map (not on a route / dot) */
  onBackgroundTap?: () => void;
  /** phone: replaces the Fullscreen API, which iOS only offers for <video> */
  onImmersive?: () => void;
  onSearchFocus?: (focused: boolean) => void;
  playingId?: string | null;
  onTogglePlay?: (id: string) => void;
  onStopPlayback?: () => void;
};

// ───────── basemaps (all key-free). Every one is a hidden raster layer; switching = toggle visibility ─────────
const BASEMAPS: Record<
  BaseKey,
  { tiles: string[]; maxzoom: number; attribution: string }
> = {
  streets: {
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution: '© OpenStreetMap contributors',
  },
  topo: {
    tiles: ['a', 'b', 'c'].map(
      (s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`,
    ),
    maxzoom: 17,
    attribution:
      '© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)',
  },
  satellite: {
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    maxzoom: 19,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
  },
};
const BASE_KEYS = Object.keys(BASEMAPS) as BaseKey[];

const STYLE = {
  version: 8,
  sources: Object.fromEntries(
    BASE_KEYS.map((k) => [
      `bm-${k}`,
      {
        type: 'raster',
        tiles: BASEMAPS[k].tiles,
        tileSize: 256,
        maxzoom: BASEMAPS[k].maxzoom,
        attribution: BASEMAPS[k].attribution,
      },
    ]),
  ),
  layers: BASE_KEYS.map((k) => ({
    id: `bm-${k}`,
    type: 'raster',
    source: `bm-${k}`,
    layout: { visibility: k === 'streets' ? 'visible' : 'none' },
    paint:
      k === 'streets'
        ? {
            'raster-saturation': -0.6,
            'raster-contrast': 0.1,
            'raster-opacity': 0.95,
          }
        : {},
  })),
} as maplibregl.StyleSpecification;

// ───────── geojson builders ─────────
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

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

// one 2-point segment per step, carrying speed + altitude, so the line can be coloured by metric
const toSegments = (clips: Clip[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: clips.flatMap((c) =>
    c.coordinates.slice(1).map((coord, k) => {
      const a = c.samples[k];
      const b = c.samples[k + 1];
      const avg = (x?: number, y?: number) =>
        x !== undefined && y !== undefined ? (x + y) / 2 : (x ?? y);
      return {
        type: 'Feature' as const,
        properties: {
          clipId: c.id,
          speed: avg(a?.speed3dKmh, b?.speed3dKmh) ?? null,
          alt: avg(a?.altM, b?.altM) ?? null,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: [c.coordinates[k], coord],
        },
      };
    }),
  ),
});

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

const dotFeature = (
  coord: [number, number] | undefined,
  color: string,
): FeatureCollection | Feature =>
  coord
    ? {
        type: 'Feature',
        properties: { color },
        geometry: { type: 'Point', coordinates: coord },
      }
    : EMPTY;

// ───────── constants / helpers ─────────
const POINT_LAYERS = ['points-selected', 'points', 'points-all', 'ends'];
const AUTO_MAX_ZOOM = 17;
const BASE_PAD = 48; // phones: padding on top of the sheet inset
const isTouch = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; // automatic fits never zoom closer than this (zoom in by hand if you want)
const HIT_MOUSE = 8; // forgiving hover radius around a dot
const HIT_TOUCH = 20; // a fingertip is ~24px wide
const PLAYHEAD_MS = 50; // phones: ~20 updates per second are plenty
const METRIC_RAMP = {
  low: '#2563eb',
  midLow: '#22c55e',
  midHigh: '#facc15',
  high: '#ef4444',
} as const;
const RAMP = Object.values(METRIC_RAMP);
const MAP_COLORS = {
  arrowFill: '#fff',
  arrowStroke: 'rgba(0,0,0,.65)',
  casing: '#fff',
  metricFallback: '#888',
  measure: '#111827',
  pointFill: '#fff',
} as const;
// every 5th sample (+ the last): 10 Hz data is far denser than the screen can show
const THINNED: maplibregl.FilterSpecification = [
  'any',
  ['==', ['%', ['get', 'i'], 5], 0],
  ['==', ['get', 'last'], true],
];

const rampExpr = (prop: string, min: number, max: number) => {
  const hi = max > min ? max : min + 1;
  const s = (hi - min) / 3;
  return [
    'interpolate',
    ['linear'],
    ['to-number', ['get', prop], min],
    min,
    RAMP[0],
    min + s,
    RAMP[1],
    min + 2 * s,
    RAMP[2],
    hi,
    RAMP[3],
  ];
};

const boundsOf = (coords: [number, number][]) =>
  coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const haversine = (a: [number, number], b: [number, number]) => {
  const h =
    Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) *
      Math.cos(rad(b[1])) *
      Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const fmtLen = (m: number) =>
  m < 1000 ? `${m.toFixed(1)} m` : `${(m / 1000).toFixed(2)} km`;

function arrowImage(): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.moveTo(8, 8);
  g.lineTo(25, 16);
  g.lineTo(8, 24);
  g.lineTo(12, 16);
  g.closePath();
  g.lineWidth = 2;
  g.strokeStyle = MAP_COLORS.arrowStroke;
  g.fillStyle = MAP_COLORS.arrowFill;
  g.stroke();
  g.fill();
  return g.getImageData(0, 0, 32, 32);
}

export default function TrackMap({
  clips,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  apiRef,
  compact = false,
  insetBottom = 0,
  profileHost = null,
  onBackgroundTap,
  onImmersive,
  onSearchFocus,
  playingId = null,
  onTogglePlay,
  onStopPlayback,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef({ onSelect, onHover, onBackgroundTap });
  const compactRef = useRef(compact);
  const lastHead = useRef(0);
  const data = useRef(clips); // latest clips for handlers registered once
  const coordEl = useRef<HTMLButtonElement>(null);
  const scaleSlot = useRef<HTMLDivElement>(null);
  const lastCoord = useRef('');
  const pinCtl = useRef<{ unpin: () => void; clipId: () => string } | null>(
    null,
  );
  const playheadClip = useRef<string | null>(null);
  const prevIds = useRef(new Set<string>());

  const { view } = useSettings();
  const [opts, setOpts] = useState<MapOpts>(loadOpts);
  // Phone: telemetry is off until the person taps the telemetry button on the map (it is never read from the
  // desktop setting, and never saved into it).
  const [phoneProfile, setPhoneProfile] = useState(false);
  const profileOn = compact ? phoneProfile : opts.profile;
  const set = (p: Partial<MapOpts>) => {
    const { profile, ...rest } = p;
    if (profile !== undefined && compact) setPhoneProfile(profile);
    setOpts((o) => ({
      ...o,
      ...rest,
      ...(profile !== undefined && !compact ? { profile } : {}),
    }));
  };
  const followRef = useRef(opts.follow);
  const [probe, setProbe] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const measuringRef = useRef(false);
  const [meas, setMeas] = useState<[number, number][]>([]);

  const sel = clips.find((c) => c.id === selectedId);
  const selIdRef = useRef(selectedId);
  useEffect(() => {
    selIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    cb.current = { onSelect, onHover, onBackgroundTap };
  }, [onSelect, onHover, onBackgroundTap]);
  useEffect(() => {
    compactRef.current = compact;
  }, [compact]);
  useEffect(() => {
    data.current = clips;
  }, [clips]);
  useEffect(() => {
    followRef.current = opts.follow;
    if (!compact) saveOpts(opts); // phone-only defaults must not leak into the desktop settings
  }, [opts, compact]);
  useEffect(() => {
    measuringRef.current = measuring;
  }, [measuring]);
  useEffect(() => {
    // The probe belongs to the previous selection/profile overlay, so clear it when either changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProbe(null);
  }, [selectedId, profileOn]);

  // value range for metric colouring (+ legend)
  const range = useMemo(() => {
    if (opts.color === 'route') return null;
    const v = clips
      .flatMap((c) =>
        c.samples.map((p) => (opts.color === 'speed' ? p.speed3dKmh : p.altM)),
      )
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
  }, [clips, opts.color]);

  // ───────── init once ─────────
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center: [0, 20], // placeholder; fitted to the data once clips load
      zoom: 1,
      attributionControl: false, // replaced by the © button (see MapCredits), same credits, closed by default
      // lets "PNG export" read the canvas; phones skip it (expensive) and export on the next render
      canvasContextAttributes: { preserveDrawingBuffer: !compactRef.current },
    } as maplibregl.MapOptions);
    map.current = m;
    const ro = new ResizeObserver(() => m.resize()); // sidebar drag / profile panel / fullscreen
    ro.observe(el.current!);

    m.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: !isTouch(), // pinch / double-tap zoom is native on touch
        visualizePitch: true,
      }),
      'top-right',
    );
    m.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right',
    );
    m.addControl(
      new maplibregl.ScaleControl({ unit: 'metric' }),
      'bottom-right',
    );
    const scaleEl = el.current?.querySelector<HTMLElement>(
      '.maplibregl-ctrl-scale',
    );
    if (scaleEl && scaleSlot.current) scaleSlot.current.append(scaleEl);

    const showCoords = (lng: number, lat: number) => {
      lastCoord.current = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      if (coordEl.current)
        coordEl.current.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    };
    m.on('mousemove', (e) => showCoords(e.lngLat.lng, e.lngLat.lat));
    // touch has no pointer position: show the map centre instead
    m.on('moveend', () => {
      if (!compactRef.current) return;
      const c = m.getCenter();
      showCoords(c.lng, c.lat);
    });
    m.on('zoom', () => {
      const c = m.getCenter();
      if (!lastCoord.current) showCoords(c.lng, c.lat);
    });

    m.on('load', () => {
      for (const id of [
        'tracks',
        'segments',
        'points',
        'ends',
        'hover',
        'pin',
        'probe',
        'playhead',
        'measure',
      ])
        m.addSource(id, {
          type: 'geojson',
          data: id === 'tracks' ? toTracks([]) : EMPTY,
          ...(id === 'tracks' && { promoteId: 'clipId' }),
        });
      m.addSource('dem', {
        type: 'raster-dem',
        tiles: [
          'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
        ],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Terrain: Mapzen / AWS Open Data',
      });
      m.addControl(
        new maplibregl.TerrainControl({ source: 'dem', exaggeration: 1.4 }),
        'top-right',
      ); // 3D terrain button
      m.addImage('arrow', arrowImage(), { pixelRatio: 2 });

      m.addLayer({
        id: 'relief',
        type: 'hillshade',
        source: 'dem',
        layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.45 },
      });

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
        id: 'tracks-casing',
        type: 'line',
        source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.casing,
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
      // invisible, wide copy of the route: a 4px line is not tappable with a finger
      m.addLayer({
        id: 'tracks-hit',
        type: 'line',
        source: 'tracks',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 24 },
      });
      // coloured-by-metric overlay (hidden in "Route" mode)
      m.addLayer({
        id: 'tracks-metric',
        type: 'line',
        source: 'segments',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: 'none',
        },
        paint: { 'line-color': MAP_COLORS.metricFallback, 'line-width': 5 },
      });
      m.addLayer({
        id: 'arrows',
        type: 'symbol',
        source: 'tracks',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 90,
          'icon-image': 'arrow',
          'icon-size': 0.55,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
          visibility: 'none',
        },
      });

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
        'circle-color': MAP_COLORS.pointFill,
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
        filter: THINNED,
        paint: dot(3.5, 2),
      });
      m.addLayer({
        id: 'points-selected',
        type: 'circle',
        source: 'points',
        minzoom: 14,
        filter: [
          'all',
          THINNED,
          ['==', ['get', 'clipId'], ''],
        ] as maplibregl.FilterSpecification,
        paint: dot(4.5, 2.5),
      });
      m.addLayer({
        id: 'ends',
        type: 'circle',
        source: 'ends',
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'case',
            ['==', ['get', 'kind'], 'end'],
            ['get', 'color'],
            MAP_COLORS.pointFill,
          ],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 3,
        },
      });

      m.addLayer({
        id: 'measure-line',
        type: 'line',
        source: 'measure',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': MAP_COLORS.measure,
          'line-width': 3,
          'line-dasharray': [2, 1.5],
        },
      });
      m.addLayer({
        id: 'measure-pts',
        type: 'circle',
        source: 'measure',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': MAP_COLORS.pointFill,
          'circle-stroke-color': MAP_COLORS.measure,
          'circle-stroke-width': 2.5,
        },
      });

      const ring = (id: string, source: string, r: number, w: number) =>
        m.addLayer({
          id,
          type: 'circle',
          source,
          paint: {
            'circle-radius': r,
            'circle-color': MAP_COLORS.pointFill,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': w,
          },
        });
      ring('hover-ring', 'hover', 8, 3.5);
      ring('pin-ring', 'pin', 10, 4);
      ring('probe-ring', 'probe', 7, 3.5);
      ring('playhead', 'playhead', 9, 4);

      // ───── point bubble: hover shows it, click pins it (close with ✕) ─────
      const popupOpts = {
        closeOnClick: false,
        closeOnMove: false,
        focusAfterOpen: false,
        maxWidth: 'none',
        offset: 14,
      } as const;
      const hoverPopup = new maplibregl.Popup({
        ...popupOpts,
        className: 'map-popup',
        closeButton: false,
      });
      const pinPopup = new maplibregl.Popup({
        ...popupOpts,
        className: 'map-popup is-pinned',
        closeButton: true,
      });
      const setSrc = (id: string, d: FeatureCollection | Feature) =>
        (m.getSource(id) as GeoJSONSource).setData(d);
      let shown = '';
      let pinned = '';
      let pinnedClip = '';
      const hide = () => {
        if (!shown) return;
        shown = '';
        hoverPopup.remove();
        setSrc('hover', EMPTY);
      };
      pinPopup.on('close', () => {
        pinned = '';
        pinnedClip = '';
        setSrc('pin', EMPTY);
      });
      pinCtl.current = {
        unpin: () => pinPopup.remove(),
        clipId: () => pinnedClip,
      };

      const nearest = (x: number, y: number) => {
        const px = isTouch() ? HIT_TOUCH : HIT_MOUSE;
        const hits = m.queryRenderedFeatures(
          [
            [x - px, y - px],
            [x + px, y + px],
          ],
          { layers: POINT_LAYERS },
        );
        let best: (typeof hits)[number] | undefined;
        let bestD = Infinity;
        for (const f of hits) {
          const p = m.project(
            (f.geometry as Point).coordinates as [number, number],
          );
          const d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d < bestD) [best, bestD] = [f, d];
        }
        const clipId = best?.properties?.clipId as string | undefined;
        const i = best?.properties?.i as number | undefined;
        if (clipId === undefined || i === undefined) return undefined;
        const clip = data.current.find((c) => c.id === clipId);
        const coord = clip?.coordinates[i];
        return clip && coord && clip.samples[i]
          ? { clip, i, coord, key: `${clipId}:${i}` }
          : undefined;
      };

      m.on('mousemove', (e) => {
        if (measuringRef.current) return hide();
        const h = nearest(e.point.x, e.point.y);
        if (h && h.clip.id === selIdRef.current) setProbe(h.i); // route hover drives the speedometer / charts
        if (!h || h.key === pinned) return hide();
        if (h.key === shown) return;
        shown = h.key;
        hoverPopup
          .setLngLat(h.coord)
          .setHTML(pointPopupHtml(h.clip, h.i))
          .addTo(m);
        setSrc('hover', dotFeature(h.coord, h.clip.color));
      });
      m.on('mouseout', hide);
      m.on('zoomstart', hide);

      m.on('click', (e) => {
        if (measuringRef.current) {
          setMeas((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
          return;
        }
        const h = nearest(e.point.x, e.point.y);
        if (!h) {
          const onRoute = m.queryRenderedFeatures(e.point, {
            layers: ['tracks-hit', 'tracks-line'],
          }).length;
          if (!onRoute) cb.current.onBackgroundTap?.();
          return;
        }
        if (h.clip.id === selIdRef.current) setProbe(h.i);
        cb.current.onSelect(h.clip.id);
        pinned = h.key;
        pinnedClip = h.clip.id;
        hide();
        pinPopup
          .setLngLat(h.coord)
          .setHTML(pointPopupHtml(h.clip, h.i))
          .addTo(m);
        setSrc('pin', dotFeature(h.coord, h.clip.color));
      });
      m.on('click', 'tracks-hit', (e) => {
        if (measuringRef.current) return;
        const id = e.features?.[0]?.properties?.clipId;
        if (id) cb.current.onSelect(id);
      });
      m.on('mousemove', 'tracks-line', (e) => {
        if (!measuringRef.current) m.getCanvas().style.cursor = 'pointer';
        cb.current.onHover(e.features?.[0]?.properties?.clipId ?? null);
      });
      m.on('mouseleave', 'tracks-line', () => {
        m.getCanvas().style.cursor = measuringRef.current ? 'crosshair' : '';
        cb.current.onHover(null);
      });
      setReady(true);
    });

    return () => {
      ro.disconnect();
      m.remove();
    };
  }, []);

  // playhead (called every frame from the video; deliberately not React state)
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      setPlayhead: (clipId, frac) => {
        const m = map.current;
        const src = m?.getSource('playhead') as GeoJSONSource | undefined;
        if (!m || !src) return;
        if (frac !== null && compactRef.current) {
          const now = performance.now();
          if (now - lastHead.current < PLAYHEAD_MS) return; // throttle on phones
          lastHead.current = now;
        }
        if (frac === null) {
          if (playheadClip.current === clipId) {
            playheadClip.current = null;
            src.setData(EMPTY);
          }
          return;
        }
        const clip = data.current.find((c) => c.id === clipId);
        if (!clip) return;
        playheadClip.current = clipId;
        const pos =
          Math.min(Math.max(frac, 0), 1) * (clip.coordinates.length - 1);
        const i = Math.min(Math.floor(pos), clip.coordinates.length - 2);
        const t = pos - i;
        const [a, b] = [clip.coordinates[i], clip.coordinates[i + 1]];
        const c: [number, number] = [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
        ];
        src.setData(dotFeature(c, clip.color));
        // same position, as a sample index: the profile charts and the speedometer follow the video
        if (clipId === selIdRef.current) setProbe(Math.round(pos));
        if (followRef.current) m.jumpTo({ center: c });
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  // geometry changes -> setData (fit only when a clip is newly added, not when one is hidden/removed)
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource('tracks') as GeoJSONSource).setData(toTracks(clips));
    (m.getSource('segments') as GeoJSONSource).setData(toSegments(clips));
    (m.getSource('points') as GeoJSONSource).setData(toPoints(clips));
    (m.getSource('ends') as GeoJSONSource).setData(toEnds(clips));
    const isNew = clips.some((c) => !prevIds.current.has(c.id));
    prevIds.current = new Set(clips.map((c) => c.id));
    if (clips.length && isNew)
      m.fitBounds(boundsOf(clips.flatMap((c) => c.coordinates)), {
        padding: compactRef.current ? BASE_PAD : 100,
        maxZoom: AUTO_MAX_ZOOM,
        duration: 0,
      });
    const pc = pinCtl.current;
    if (pc && pc.clipId() && !clips.some((c) => c.id === pc.clipId()))
      pc.unpin();
  }, [clips, ready]);

  // basemap
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    BASE_KEYS.forEach((k) =>
      m.setLayoutProperty(
        `bm-${k}`,
        'visibility',
        k === opts.base ? 'visible' : 'none',
      ),
    );
  }, [opts.base, ready]);

  // metric colouring
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !range || opts.color === 'route') return;

    m.setPaintProperty(
      'tracks-metric',
      'line-color',
      rampExpr(
        opts.color === 'speed' ? 'speed' : 'alt',
        range.min,
        range.max,
      ) as maplibregl.ExpressionSpecification,
    );
  }, [ready, range, opts.color, clips]);

  // interaction state + display options -> feature-state / layer props
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    clips.forEach((c) =>
      m.setFeatureState(
        { source: 'tracks', id: c.id },
        { selected: c.id === selectedId, hovered: c.id === hoveredId },
      ),
    );

    const vis = (id: string, on: boolean) =>
      m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    const dense = opts.points === 'all';
    m.setFilter('points', dense ? null : THINNED);
    m.setFilter('points-selected', [
      'all',
      ...(dense ? [] : [THINNED]),
      ['==', ['get', 'clipId'], selectedId ?? ''],
    ] as maplibregl.FilterSpecification);
    (['points', 'points-selected', 'points-all'] as const).forEach((id) =>
      vis(id, opts.points !== 'off'),
    );
    vis('ends', opts.ends);
    vis('arrows', opts.arrows);
    vis('relief', opts.relief);

    const metric = opts.color !== 'route';
    vis('tracks-metric', metric && !!range);

    const isSel: maplibregl.ExpressionSpecification = [
      'boolean',
      ['feature-state', 'selected'],
      false,
    ];

    m.setPaintProperty(
      'tracks-line',
      'line-opacity',
      metric && range ? 0 : opts.focus ? ['case', isSel, 1, 0.3] : 1,
    );
    m.setPaintProperty(
      'tracks-casing',
      'line-opacity',
      opts.focus ? ['case', isSel, 0.9, 0.25] : 0.9,
    );
    m.setPaintProperty(
      'tracks-metric',
      'line-opacity',
      opts.focus
        ? ([
            'case',
            ['==', ['get', 'clipId'], selectedId ?? ''],
            1,
            0.3,
          ] as maplibregl.ExpressionSpecification)
        : 1,
    );
  }, [clips, selectedId, hoveredId, ready, opts, range]);

  // the sheet covers the bottom of the map: pad the camera so fits and "follow" use the visible part
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const h = m.getContainer().clientHeight;
    const bottom = compact ? Math.min(insetBottom, h * 0.55) : 0;
    m.setPadding({ top: 0, left: 0, right: 0, bottom });
  }, [insetBottom, compact, ready]);

  // camera only moves on intentional selection
  useEffect(() => {
    const m = map.current;
    const clip = clips.find((c) => c.id === selectedId);
    if (!ready || !m || !clip) return;
    const pad = compact ? BASE_PAD : 120;
    m.fitBounds(boundsOf(clip.coordinates), {
      padding: { top: pad, bottom: pad, left: pad, right: pad },
      duration: 600,
      maxZoom: AUTO_MAX_ZOOM,
    });
  }, [selectedId, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // elevation-profile hover marker
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource('probe') as GeoJSONSource).setData(
      sel && probe !== null
        ? dotFeature(sel.coordinates[probe], sel.color)
        : EMPTY,
    );
  }, [probe, sel, ready]);

  // measure tool
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const feats: Feature[] = meas.map((c) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: c },
    }));
    if (meas.length > 1)
      feats.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: meas },
      });
    (m.getSource('measure') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: feats,
    });
  }, [meas, ready]);
  useEffect(() => {
    const m = map.current;
    if (m) m.getCanvas().style.cursor = measuring ? 'crosshair' : '';
  }, [measuring]);
  const measured = meas.reduce(
    (s, c, i) => (i ? s + haversine(meas[i - 1], c) : 0),
    0,
  );

  // ───────── actions ─────────
  const fitAll = () => {
    if (clips.length)
      map.current?.fitBounds(boundsOf(clips.flatMap((c) => c.coordinates)), {
        padding: compact ? BASE_PAD : 100,
        maxZoom: AUTO_MAX_ZOOM,
        duration: 500,
      });
  };
  const fitSelected = () => {
    if (sel)
      map.current?.fitBounds(boundsOf(sel.coordinates), {
        padding: compact ? BASE_PAD : 120,
        maxZoom: AUTO_MAX_ZOOM,
        duration: 500,
      });
  };
  const fullscreen = () => {
    if (compact && onImmersive) return onImmersive();
    const box = el.current?.closest('.map-column');
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box?.requestFullscreen?.();
  };
  const exportAs = (kind: 'gpx' | 'geojson' | 'png') => {
    const save = (blob: Blob, name: string) => {
      // iOS only previews a plain download: hand the file to the share sheet when it can take files
      const file = new File([blob], name, { type: blob.type });
      if (compact && navigator.canShare?.({ files: [file] }))
        navigator.share({ files: [file] }).catch(() => {});
      else download(blob, name);
    };
    if (kind === 'png') {
      const m = map.current;
      if (!m) return;
      // no preserveDrawingBuffer on phones: read the canvas right after a fresh render
      m.once('render', () => {
        try {
          m.getCanvas().toBlob((b) => b && save(b, 'clip-to-track-map.png'));
        } catch {
          /* tainted canvas (a tile server without CORS) */
        }
      });
      m.triggerRepaint();
    } else if (sel) {
      const body = kind === 'gpx' ? clipToGpx(sel) : clipToGeoJson(sel);
      save(
        new Blob([body], { type: 'application/octet-stream' }),
        `${sel.title}.${kind === 'gpx' ? 'gpx' : 'geojson'}`,
      );
    }
  };

  const profile =
    profileOn && sel ? (
      <ElevationProfile
        compact={compact}
        clip={sel}
        probe={probe}
        onProbe={setProbe}
        onClose={() => set({ profile: false })}
        playback={
          compact && onTogglePlay && onStopPlayback
            ? {
                playing: sel.id === playingId,
                onTogglePlay: () => onTogglePlay(sel.id),
                onStop: onStopPlayback,
              }
            : undefined
        }
      />
    ) : null;
  const unit = opts.color === 'speed' ? 'km/h' : 'm';

  return (
    <div
      className={`map-column${view.zoom ? '' : ' hides-zoom'}${view.gps ? '' : ' hides-location'}${view.terrain ? '' : ' hides-terrain'}${view.scale ? '' : ' hides-scale'}`}
    >
      <div className="map-stage">
        <div ref={el} className="map-canvas" />
        <MapPanel
          opts={{ ...opts, profile: profileOn }}
          set={set}
          hasClips={clips.length > 0}
          hasSelected={!!sel}
          measuring={measuring}
          onMeasure={() => setMeasuring((v) => !v)}
          onFitAll={fitAll}
          onFitSelected={fitSelected}
          onFullscreen={fullscreen}
          onExport={exportAs}
          compact={compact}
          onSearchFocus={onSearchFocus}
          onGo={(b) => {
            const next = map.current?.cameraForBounds(b, {
              padding: 40,
              maxZoom: 16,
            });
            if (next) map.current?.jumpTo(next);
          }}
        />

        {range && view.legend && (
          <div
            className="map-legend"
            aria-label={`Colour scale: ${opts.color}`}
          >
            <span>{range.min.toFixed(0)}</span>
            <i
              style={{
                background: `linear-gradient(90deg, ${RAMP.join(',')})`,
              }}
            />
            <span>
              {range.max.toFixed(0)} {unit}
            </span>
          </div>
        )}

        {(measuring || meas.length > 0) && (
          <div className="measure-bar">
            <Icon name="ruler" size={14} />
            <strong>
              {meas.length > 1
                ? fmtLen(measured)
                : compact
                  ? 'Tap the map to measure'
                  : 'Click the map to measure'}
            </strong>
            <button
              className="link-button"
              onClick={() => setMeas((p) => p.slice(0, -1))}
              disabled={!meas.length}
            >
              Undo
            </button>
            <button
              className="link-button"
              onClick={() => setMeas([])}
              disabled={!meas.length}
            >
              Clear
            </button>
            {measuring && (
              <button
                className="link-button"
                onClick={() => setMeasuring(false)}
              >
                Done
              </button>
            )}
          </div>
        )}

        <div
          className="map-credits"
          style={compact ? { bottom: insetBottom + 8 } : undefined}
        >
          <div className="map-scale-cluster">
            {view.coords && (
              <span
                ref={coordEl}
                className="map-coordinates"
                title="Click to copy coordinates"
                onClick={() =>
                  lastCoord.current &&
                  void navigator.clipboard?.writeText(lastCoord.current)
                }
              >
                lat, lon
              </span>
            )}
            <span ref={scaleSlot} className="map-scale-slot" />
          </div>

          <span className="map-credit-button">
            © {COPYRIGHT_OWNER} {new Date().getUTCFullYear()} · © OpenStreetMap
          </span>
        </div>
      </div>

      {/* phones: portalled into the sheet (state and probe wiring stay here); never under the map */}
      {profileHost
        ? createPortal(profile, profileHost)
        : compact
          ? null
          : profile}
    </div>
  );
}
