import type { Clip } from './types';

/**
 * Automatic projects ("trips").
 * A clip joins an existing project when it starts within GAP_DAYS of that project's clips AND within
 * MAX_KM of one of them, as long as the project would not grow beyond MAX_SPAN_DAYS. Otherwise it
 * starts a new project. Clips without a date go to a single "Undated clips" project.
 * Projects are persisted (not recomputed), so ids stay stable and "existing vs new" is meaningful.
 */
export const GAP_DAYS = 2;
export const MAX_SPAN_DAYS = 14;
export const MAX_KM = 150;
export const UNDATED_ID = 'undated';
/** drag & drop payload type for moving a clip between projects */
export const CLIP_MIME = 'application/x-ctt-clip';

// ───────── random project names: "Fabulous Times" ─────────
const ADJECTIVES = [
  'Fabulous',
  'Epic',
  'Golden',
  'Wild',
  'Breezy',
  'Lucky',
  'Sunny',
  'Misty',
  'Daring',
  'Cosmic',
  'Rowdy',
  'Wandering',
  'Hidden',
  'Electric',
  'Cheerful',
  'Rugged',
  'Dusty',
  'Glorious',
  'Midnight',
  'Roaming',
  'Sparkling',
  'Blazing',
  'Gentle',
  'Mighty',
  'Quirky',
  'Velvet',
  'Salty',
  'Crisp',
  'Restless',
  'Jolly',
  'Fearless',
  'Lazy',
  'Hazy',
  'Zesty',
  'Brave',
  'Mellow',
];
const NOUNS = [
  'Times',
  'Adventures',
  'Escapades',
  'Detours',
  'Miles',
  'Roads',
  'Trails',
  'Getaways',
  'Voyages',
  'Days',
  'Wanderings',
  'Journeys',
  'Chases',
  'Loops',
  'Rides',
  'Summits',
  'Horizons',
  'Shenanigans',
  'Memories',
  'Expeditions',
  'Switchbacks',
  'Sprints',
  'Odysseys',
  'Cruises',
  'Tales',
  'Chapters',
  'Moments',
  'Mornings',
];
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** Deterministic for a given seed (safe during render); skips names already taken. */
export function pickTitle(seed: string, taken: Iterable<string>) {
  const used = new Set(taken);
  let h = hash(seed);
  for (let i = 0; i < ADJECTIVES.length * NOUNS.length; i++) {
    const name = `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length]}`;
    if (!used.has(name)) return name;
    h = hash(`${h}:${i}`);
  }
  return seed;
}
/** A fresh random name (call from event handlers, not during render). */
export const suggestName = (taken: Iterable<string>) =>
  pickTitle(String(Math.random()), taken);
export const namesOf = (list: Project[]) =>
  list.map((p) => p.name ?? p.title ?? '');

const DAY = 86_400_000;

export type Project = {
  id: string;
  clipIds: string[];
  /** reverse-geocoded place of the first clip; '' = looked up, nothing found; undefined = not looked up yet */
  place?: string;
  /** random generated name, assigned once so it stays stable */
  title?: string;
  /** user-chosen name; wins over title */
  name?: string;
  /** created by hand: survives being empty (auto projects vanish with their last clip) */
  manual?: boolean;
};

export type Placement = {
  clipId: string;
  projectId: string;
  /** true when the project was created for this upload */
  created: boolean;
};

export type ProjectView = {
  id: string;
  /** what to display: custom name, else the generated title */
  name: string;
  /** true when the user renamed it */
  custom: boolean;
  place?: string;
  range: string;
  clipIds: string[];
  from?: number;
  to?: number;
  days: number;
  distanceM: number;
};

const startOf = (c: Clip) => c.sort.date;
const endOf = (c: Clip) => (c.sort.date ?? 0) + (c.sort.duration ?? 0) * 1000;

function km([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) *
      Math.cos(lat2 * r) *
      Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** Deterministic (no randomness: assignment runs during render). */
function uniqueId(list: Project[], clipId: string) {
  let id = `trip-${clipId}`;
  while (list.some((p) => p.id === id)) id += '+';
  return id;
}

/** How well clip c fits project p: undefined = doesn't fit, else [gapMs, km] (lower is better). */
function fit(
  p: Project,
  c: Clip,
  byId: Map<string, Clip>,
): [number, number] | undefined {
  const members = p.clipIds
    .map((id) => byId.get(id))
    .filter((m): m is Clip => !!m && startOf(m) !== undefined);
  if (!members.length) return undefined;
  const from = Math.min(...members.map((m) => startOf(m)!));
  const to = Math.max(...members.map(endOf));
  const cs = startOf(c)!;
  const ce = endOf(c);
  const gap = cs > to ? cs - to : ce < from ? from - ce : 0;
  if (gap > GAP_DAYS * DAY) return undefined;
  if (Math.max(to, ce) - Math.min(from, cs) > MAX_SPAN_DAYS * DAY)
    return undefined;
  const dist = Math.min(
    ...members.map((m) => km(m.coordinates[0], c.coordinates[0])),
  );
  return dist <= MAX_KM ? [gap, dist] : undefined;
}

const cmpDate = (a?: number, b?: number) => {
  const x = a ?? Infinity;
  const y = b ?? Infinity;
  return x === y ? 0 : x < y ? -1 : 1;
};

/**
 * Drops vanished clips / empty projects, then places every unassigned clip (oldest first).
 * Returns the same array when nothing changed.
 */
export function assign(prev: Project[], clips: Clip[]) {
  const byId = new Map(clips.map((c) => [c.id, c]));
  let changed = false;
  let list = prev
    .map((p) => {
      const ids = p.clipIds.filter((id) => byId.has(id));
      if (ids.length === p.clipIds.length) return p;
      changed = true;
      return { ...p, clipIds: ids };
    })
    .filter((p) => {
      if (p.clipIds.length || p.manual) return true;
      changed = true;
      return false;
    });

  // legacy projects (saved before random names existed) get a title once
  if (list.some((p) => !p.title && p.id !== UNDATED_ID)) {
    changed = true;
    const taken = namesOf(list);
    list = list.map((p) => {
      if (p.title || p.id === UNDATED_ID) return p;
      const title = pickTitle(p.id, taken);
      taken.push(title);
      return { ...p, title };
    });
  }

  const assigned = new Set(list.flatMap((p) => p.clipIds));
  const todo = clips
    .filter((c) => !assigned.has(c.id))
    .sort((a, b) => cmpDate(startOf(a), startOf(b)));
  const placements: Placement[] = [];

  if (todo.length) {
    changed = true;
    list = list.map((p) => ({ ...p, clipIds: [...p.clipIds] }));
    const createdNow = new Set<string>();
    for (const c of todo) {
      let target: Project | undefined;
      if (startOf(c) === undefined) {
        target = list.find((p) => p.id === UNDATED_ID);
      } else {
        let best: [number, number] | undefined;
        for (const p of list) {
          const f = fit(p, c, byId);
          if (
            f &&
            (!best || f[0] < best[0] || (f[0] === best[0] && f[1] < best[1]))
          ) {
            best = f;
            target = p;
          }
        }
      }
      if (target) {
        target.clipIds.push(c.id);
      } else {
        target = {
          id: startOf(c) === undefined ? UNDATED_ID : uniqueId(list, c.id),
          clipIds: [c.id],
          title:
            startOf(c) === undefined
              ? undefined
              : pickTitle(c.id, namesOf(list)),
        };
        list.push(target);
        createdNow.add(target.id);
      }
      placements.push({
        clipId: c.id,
        projectId: target.id,
        created: createdNow.has(target.id),
      });
    }
  }
  return { projects: changed ? list : prev, changed, placements };
}

export const newProjectId = (list: Project[], clipId: string) =>
  uniqueId(list, clipId);

function fmtRange(from?: number, to?: number) {
  if (from === undefined || to === undefined) return 'No date';
  const a = new Date(from);
  const b = new Date(to);
  const md = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (a.toDateString() === b.toDateString())
    return `${md(a)}, ${a.getFullYear()}`;
  if (a.getFullYear() !== b.getFullYear())
    return `${md(a)}, ${a.getFullYear()} – ${md(b)}, ${b.getFullYear()}`;
  return a.getMonth() === b.getMonth()
    ? `${md(a)}–${b.getDate()}, ${a.getFullYear()}`
    : `${md(a)} – ${md(b)}, ${a.getFullYear()}`;
}

/** Display data for every project, newest first (undated last). */
export function projectViews(
  projects: Project[],
  clips: Clip[],
  /** clip id → place name (reverse-geocoded); a project is named after its first clip's place */
  clipPlace: Record<string, string> = {},
): ProjectView[] {
  const byId = new Map(clips.map((c) => [c.id, c]));
  return (
    projects
      .map((p) => {
        const cs = p.clipIds
          .map((id) => byId.get(id))
          .filter((c): c is Clip => !!c);
        const starts = cs
          .map(startOf)
          .filter((n): n is number => n !== undefined);
        const from = starts.length ? Math.min(...starts) : undefined;
        const to = starts.length ? Math.max(...starts) : undefined;
        const range = cs.length ? fmtRange(from, to) : 'No clips yet';
        // generated names read "[Adjective] [Noun] in [place]" once the place is known.
        // The place is the area most of the project's clips are in (ties: the earliest clip's),
        // not simply where the first clip happens to start.
        const counts = new Map<string, number>();
        for (const id of p.clipIds) {
          const pl = clipPlace[id];
          if (pl) counts.set(pl, (counts.get(pl) ?? 0) + 1);
        }
        let place = '';
        let top = 0;
        for (const [pl, n] of counts)
          if (n > top) [place, top] = [pl, n];
        place = place || p.place || '';
        const generated =
          p.id === UNDATED_ID ? 'Undated' : (p.title ?? 'Project');
        return {
          id: p.id,
          name:
            p.name ??
            (place && p.id !== UNDATED_ID
              ? `${generated} in ${place}`
              : generated),
          custom: !!p.name,
          place: place || undefined,
          range,
          clipIds: p.clipIds,
          from,
          to,
          days: new Set(
            starts.map((ms) => new Date(ms).toLocaleDateString('en-CA')),
          ).size,
          distanceM: cs.reduce((s, c) => s + (c.sort.distance ?? 0), 0),
        } satisfies ProjectView;
      })
      // empty (just created) first, then newest first, undated last
      .sort((a, b) => {
        const ea = a.clipIds.length === 0;
        const eb = b.clipIds.length === 0;
        if (ea !== eb) return ea ? -1 : 1;
        return a.from === undefined
          ? b.from === undefined
            ? 0
            : 1
          : b.from === undefined
            ? -1
            : b.from - a.from;
      })
  );
}

export const fmtKm = (m: number) =>
  m < 1000
    ? `${Math.round(m)} m`
    : `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
