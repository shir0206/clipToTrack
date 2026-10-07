import { useCallback, useEffect, useRef, useState } from 'react';
import SvgIcon, { type IconName } from '../common/SvgIcon';
import { useSettings } from '../../lib/settings';
import { satelliteDefault } from '../mapDefault';

export type BaseKey = 'streets' | 'topo' | 'satellite';
export const BASE_LABELS: Record<BaseKey, string> = {
  streets: 'Streets',
  topo: 'Topo',
  satellite: 'Satellite',
};

export type MapOpts = {
  base: BaseKey;
  color: 'route' | 'speed' | 'altitude';
  points: 'off' | 'auto' | 'all';
  ends: boolean;
  arrows: boolean;
  relief: boolean;
  focus: boolean;
  follow: boolean;
  profile: boolean;
};
export const DEFAULT_OPTS: MapOpts = {
  base: 'streets',
  color: 'route',
  points: 'auto',
  ends: true,
  arrows: false,
  relief: false,
  focus: false,
  follow: false,
  profile: false,
};
const KEY = 'clip-to-track:map-opts:v4';
/**
 * The basemap is NOT saved with the other options: the map always opens as the Settings default
 * (satellite unless the person switched "Satellite map by default" off, then streets as before).
 * A saved `base` would otherwise win over the setting forever.
 */
export const loadOpts = (): MapOpts => {
  const base: BaseKey = satelliteDefault() ? 'satellite' : 'streets';
  try {
    return {
      ...DEFAULT_OPTS,
      ...JSON.parse(localStorage.getItem(KEY) ?? '{}'),
      base,
    };
  } catch {
    return { ...DEFAULT_OPTS, base };
  }
};
export const saveOpts = (o: MapOpts) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...o, base: undefined })); // undefined is dropped by JSON
  } catch {
    /* ignore */
  }
};

type Props = {
  opts: MapOpts;
  set: (p: Partial<MapOpts>) => void;
  hasClips: boolean;
  hasSelected: boolean;
  measuring: boolean;
  onMeasure: () => void;
  onFitAll: () => void;
  onFitSelected: () => void;
  onFullscreen: () => void;
  onExport: (kind: 'gpx' | 'geojson' | 'png') => void;
  onGo: (bbox: [number, number, number, number]) => void; // [w, s, e, n]
};

// ───────── place search: type-ahead from the 4th character ─────────
const MIN_CHARS = 4;
type Hit = { place_id: number; display_name: string; boundingbox: string[] };

function PlaceSearch({ onGo }: { onGo: Props['onGo'] }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  );
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const skip = useRef(false); // don't re-search right after picking a result
  const text = q.trim();

  const run = useCallback(async (t: string) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setState('loading');
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(t)}`,
        { signal: ac.signal },
      );
      const j: Hit[] = await r.json();
      setHits(j);
      setActive(j.length ? 0 : -1);
      setState('done');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setState('error');
    }
  }, []);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (text.length < MIN_CHARS) {
      abort.current?.abort();
      // This reset is tied to the debounced search side effect: stale remote hits must be cleared
      // as soon as the query stops being searchable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      setState('idle');
      return;
    }
    const id = setTimeout(() => run(text), 350); // debounce keeps us polite to Nominatim
    return () => clearTimeout(id);
  }, [text, run]);

  const pick = (h: Hit) => {
    const [s, n, w, e] = h.boundingbox.map(Number);
    onGo([w, s, e, n]);
    abort.current?.abort();
    const name = h.display_name.split(',')[0];
    if (name !== text) skip.current = true; // the text change below must not trigger a new search
    setQ(name);
    setHits([]);
    setState('idle');
    input.current?.blur();
  };

  // what the dropdown shows; null = nothing, so it never renders as an empty box
  const view: 'hint' | 'loading' | 'error' | 'empty' | 'list' | null =
    text.length === 0
      ? null
      : text.length < MIN_CHARS
        ? 'hint'
        : hits.length
          ? 'list'
          : state === 'loading'
            ? 'loading'
            : state === 'error'
              ? 'error'
              : state === 'done'
                ? 'empty'
                : null;
  const open = focused && view !== null;
  const listId = 'ctt-search-list';

  return (
    <div className="search-box">
      <SvgIcon name="search" size={15} className="search-icon" />
      <input
        ref={input}
        value={q}
        placeholder="Search a place…"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `ctt-hit-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && hits.length) {
            e.preventDefault();
            setActive((a) => (a + 1) % hits.length);
          } else if (e.key === 'ArrowUp' && hits.length) {
            e.preventDefault();
            setActive((a) => (a - 1 + hits.length) % hits.length);
          } else if (e.key === 'Enter') {
            if (hits[active]) pick(hits[active]);
            else if (text.length >= 2) run(text); // Enter forces a search even for short text
          } else if (e.key === 'Escape') {
            setQ('');
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {q && (
        <button
          className="search-clear"
          aria-label="Clear search"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setQ('')}
        >
          <SvgIcon name="close" size={13} />
        </button>
      )}
      {open && (
        <div
          className="dropdown-menu search-results"
          onPointerDown={(e) => e.preventDefault() /* keep input focus */}
        >
          {view === 'hint' ? (
            <p className="dropdown-note">
              Keep typing — suggestions appear from {MIN_CHARS} characters
            </p>
          ) : view === 'loading' ? (
            <p className="dropdown-note">Searching…</p>
          ) : view === 'error' ? (
            <p className="dropdown-note">
              Search failed — check your connection
            </p>
          ) : view === 'empty' ? (
            <p className="dropdown-note">No places found</p>
          ) : (
            <ul id={listId} role="listbox">
              {hits.map((h, i) => {
                const [main, ...rest] = h.display_name.split(',');
                return (
                  <li
                    key={h.place_id}
                    id={`ctt-hit-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? 'is-active' : ''}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(h)}
                  >
                    <strong>{main}</strong>
                    <span>{rest.join(',').trim()}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ───────── toolbar bits ─────────
function IconBtn({
  icon,
  label,
  on,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`toolbar-button${on ? ' is-on' : ''}`}
      data-tip={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
    >
      <SvgIcon name={icon} size={16} />
    </button>
  );
}

type Item<T extends string> = { value: T; label: string };

function Dropdown<T extends string>({
  id,
  openId,
  setOpenId,
  icon,
  title,
  current,
  items,
  onPick,
  disabled,
}: {
  id: string;
  openId: string | null;
  setOpenId: (v: string | null) => void;
  icon: IconName;
  title: string;
  current?: T;
  items: Item<T>[];
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
  const open = openId === id;
  const label = items.find((i) => i.value === current)?.label;
  return (
    <div className="dropdown-anchor">
      <button
        className={`toolbar-button toolbar-menu${open ? ' is-on' : ''}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpenId(open ? null : id)}
      >
        <SvgIcon name={icon} size={16} />
        <span>{label ?? title}</span>
        <SvgIcon name="chevron" size={12} />
      </button>
      {open && (
        <div className="dropdown-menu" role="menu">
          {items.map((i) => (
            <button
              key={i.value}
              role="menuitemradio"
              aria-checked={i.value === current}
              className={i.value === current ? 'is-active' : ''}
              onClick={() => {
                onPick(i.value);
                setOpenId(null);
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const BASES = (Object.keys(BASE_LABELS) as BaseKey[]).map((k) => ({
  value: k,
  label: BASE_LABELS[k],
}));
const COLORS: Item<MapOpts['color']>[] = [
  { value: 'route', label: 'Route colour' },
  { value: 'speed', label: 'Speed' },
  { value: 'altitude', label: 'Altitude' },
];
const POINTS: Item<MapOpts['points']>[] = [
  { value: 'off', label: 'Points off' },
  { value: 'auto', label: 'Points auto' },
  { value: 'all', label: 'Every sample' },
];
const EXPORTS: Item<'gpx' | 'geojson' | 'png'>[] = [
  { value: 'gpx', label: 'GPX (selected clip)' },
  { value: 'geojson', label: 'GeoJSON (selected clip)' },
  { value: 'png', label: 'Map image (PNG)' },
];

/** Toolbar docked along the top of the map. */
export default function MapPanel({
  opts,
  set,
  hasClips,
  hasSelected,
  measuring,
  onMeasure,
  onFitAll,
  onFitSelected,
  onFullscreen,
  onExport,
  onGo,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const { view } = useSettings();

  // close menus on outside click / Escape
  useEffect(() => {
    if (!openId) return;
    const down = (e: PointerEvent) =>
      !bar.current?.contains(e.target as Node) && setOpenId(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpenId(null);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [openId]);

  const dd = { openId, setOpenId };
  if (!view.search && !view.mapStyle && !view.layers && !view.tools)
    return null;
  return (
    <div
      className="map-toolbar"
      ref={bar}
      role="toolbar"
      aria-label="Map tools"
    >
      {view.search && <PlaceSearch onGo={onGo} />}

      {view.mapStyle && (
        <div className="toolbar-group">
          <Dropdown
            {...dd}
            id="base"
            icon="layers"
            title="Basemap"
            current={opts.base}
            items={BASES}
            onPick={(base) => set({ base })}
          />
          <Dropdown
            {...dd}
            id="color"
            icon="gauge"
            title="Colour by"
            current={opts.color}
            items={COLORS}
            onPick={(color) => set({ color })}
          />
          <Dropdown
            {...dd}
            id="points"
            icon="gps"
            title="Points"
            current={opts.points}
            items={POINTS}
            onPick={(points) => set({ points })}
          />
        </div>
      )}

      {view.layers && (
        <div className="toolbar-group">
          <IconBtn
            icon="gps"
            label="Start / end markers"
            on={opts.ends}
            onClick={() => set({ ends: !opts.ends })}
          />
          <IconBtn
            icon="arrowUp"
            label="Direction arrows"
            on={opts.arrows}
            onClick={() => set({ arrows: !opts.arrows })}
          />
          <IconBtn
            icon="mountain"
            label="Hillshade relief"
            on={opts.relief}
            onClick={() => set({ relief: !opts.relief })}
          />
          <IconBtn
            icon="eye"
            label="Focus selected clip"
            on={opts.focus}
            onClick={() => set({ focus: !opts.focus })}
          />
          <IconBtn
            icon="play"
            label="Follow playhead"
            on={opts.follow}
            onClick={() => set({ follow: !opts.follow })}
          />
          <IconBtn
            icon="chart"
            label="Elevation profile"
            on={opts.profile}
            disabled={!hasSelected}
            onClick={() => set({ profile: !opts.profile })}
          />
        </div>
      )}

      {view.tools && (
        <div className="toolbar-group">
          <IconBtn
            icon="ruler"
            label="Measure distance"
            on={measuring}
            onClick={onMeasure}
          />
          <IconBtn
            icon="fit"
            label="Fit all clips"
            disabled={!hasClips}
            onClick={onFitAll}
          />
          <IconBtn
            icon="route"
            label="Fit selected clip"
            disabled={!hasSelected}
            onClick={onFitSelected}
          />
          <IconBtn
            icon="maximize"
            label="Fullscreen map"
            onClick={onFullscreen}
          />
          <Dropdown
            {...dd}
            id="export"
            icon="download"
            title="Export"
            items={EXPORTS}
            onPick={onExport}
          />
        </div>
      )}
    </div>
  );
}
