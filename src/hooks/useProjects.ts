import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Clip } from '../types';
import {
  assign,
  namesOf,
  newProjectId,
  pickTitle,
  projectViews,
  suggestName,
  UNDATED_ID,
  type Placement,
  type Project,
} from '../lib/projects';
import { emitLocalChange } from '../lib/sync/changeBus';
import { exampleState } from '../components/ExampleProject/exampleProject';

const KEY = 'clip-to-track:projects:v1';
const PLACES_KEY = 'clip-to-track:clip-places:v1';
const MODE_KEY = 'clip-to-track:project-mode:v1';

// ───────── "Group clips into projects" preference (on by default) ─────────
// A tiny shared store so the Settings dialog and the sidebar always agree.
let projectModeOn = (() => {
  try {
    return localStorage.getItem(MODE_KEY) !== '0';
  } catch {
    return true;
  }
})();
const modeListeners = new Set<() => void>();
function commitProjectMode(on: boolean) {
  projectModeOn = on;
  try {
    localStorage.setItem(MODE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  modeListeners.forEach((l) => l());
}
export function setProjectMode(on: boolean) {
  commitProjectMode(on);
  emitLocalChange('projectMode');
}
/** A value that arrived from the cloud: applied like a normal change, but never reported back (no echo). */
export const applyRemoteProjectMode = commitProjectMode;
export const getProjectMode = () => projectModeOn;
export const useProjectMode = () =>
  useSyncExternalStore(
    (cb) => {
      modeListeners.add(cb);
      return () => {
        modeListeners.delete(cb);
      };
    },
    () => projectModeOn,
    () => true,
  );

function load(): Project[] {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    const list = Array.isArray(arr)
      ? (arr as Project[]).filter((p) => p && p.id && Array.isArray(p.clipIds))
      : [];
    return lockExample(list);
  } catch {
    return [];
  }
}

/**
 * Projects saved before the example became read-only: lock it now. If the person had already put clips of
 * their own into it, it stays an ordinary project (they keep control of what is theirs).
 */
function lockExample(list: Project[]): Project[] {
  const { projectId, clipIds } = exampleState();
  if (!projectId) return list;
  return list.map((p) =>
    p.id === projectId &&
    !p.locked &&
    p.clipIds.every((id) => clipIds.includes(id))
      ? { ...p, locked: true }
      : p,
  );
}

function loadPlaces(): Record<string, string> {
  try {
    const o: unknown = JSON.parse(localStorage.getItem(PLACES_KEY) ?? '{}');
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    return Object.fromEntries(
      Object.entries(o).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Nominatim reverse lookup: the town / city a point is in ('' = nothing found). */
async function reverse(lon: number, lat: number): Promise<string> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`,
  );
  const a = (await res.json())?.address ?? {};
  return (
    a.city || a.town || a.village || a.municipality || a.county || a.state || ''
  );
}

/**
 * Keeps every clip in a project, automatically. Pass the current clips; the hook assigns new ones
 * (during render, so the first paint is already consistent) and reports where uploads landed.
 * It also looks up the place name of every clip (shown on the card) and of every project.
 */
export function useProjects(clips: Clip[]) {
  const [projects, setProjects] = useState<Project[]>(load);
  const [clipPlace, setClipPlace] =
    useState<Record<string, string>>(loadPlaces);
  const [notice, setNotice] = useState<Placement[] | null>(null);
  // clips present at startup are migrated silently; only later additions produce a notice
  const [initialIds] = useState(() => new Set(clips.map((c) => c.id)));

  const r = assign(projects, clips);
  if (r.changed) {
    setProjects(r.projects);
    const fresh = r.placements.filter((p) => !initialIds.has(p.clipId));
    if (fresh.length) setNotice(fresh);
  }

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(projects));
    } catch {
      /* ignore */
    }
  }, [projects]);
  useEffect(() => {
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(clipPlace));
    } catch {
      /* ignore */
    }
  }, [clipPlace]);

  // Place names (Nominatim allows one request per second). A project is named after the place of
  // its first clip, so those clips are looked up first, then the rest (for the card subtitles).
  const asked = useRef(new Set<string>());
  const busy = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (busy.current) return;
    const byId = new Map(clips.map((c) => [c.id, c]));
    const firsts = projects
      .filter((p) => p.id !== UNDATED_ID)
      .map((p) => byId.get(p.clipIds[0]))
      .filter((c): c is Clip => !!c);
    const clip = [...firsts, ...clips].find(
      (c) => clipPlace[c.id] === undefined && !asked.current.has(c.id),
    );
    if (!clip) return;

    asked.current.add(clip.id);
    busy.current = true;
    const [lon, lat] = clip.coordinates[0];
    reverse(lon, lat)
      .then((place) => setClipPlace((m) => ({ ...m, [clip.id]: place })))
      .catch(() => {
        /* offline: tried once this session; retried on the next visit */
      })
      .finally(() =>
        setTimeout(() => {
          busy.current = false;
          setTick((t) => t + 1);
        }, 1100),
      );
  }, [projects, clips, clipPlace, tick]);

  const views = useMemo(
    () => projectViews(projects, clips, clipPlace),
    [projects, clips, clipPlace],
  );
  const projectOf = useMemo(
    () =>
      new Map(
        projects.flatMap((p) => p.clipIds.map((id) => [id, p.id] as const)),
      ),
    [projects],
  );

  /** ids of the clips that live in a read-only project (they cannot be dragged or moved) */
  const lockedClips = useMemo(
    () =>
      new Set(projects.filter((p) => p.locked).flatMap((p) => p.clipIds)),
    [projects],
  );

  /** Move a clip to another project, or to a brand-new one ('new'). */
  const moveClip = (clipId: string, target: string | 'new') => {
    // the example is read-only: nothing moves into it or out of it (the UI hides these paths; this is the safety net)
    const locked = new Set(projects.filter((p) => p.locked).map((p) => p.id));
    if (locked.has(projectOf.get(clipId) ?? '') || locked.has(target)) return;
    const rest = projects.map((p) => ({
      ...p,
      clipIds: p.clipIds.filter((id) => id !== clipId),
    }));
    if (projectOf.get(clipId) === target) return;
    const id = target === 'new' ? newProjectId(rest, clipId) : target;
    const next =
      target === 'new'
        ? [
            ...rest,
            { id, clipIds: [clipId], title: pickTitle(id, namesOf(rest)) },
          ]
        : rest.map((p) =>
            p.id === id ? { ...p, clipIds: [...p.clipIds, clipId] } : p,
          );
    setProjects(next.filter((p) => p.clipIds.length || p.manual));
    setNotice(
      (n) =>
        n &&
        n.map((x) =>
          x.clipId === clipId
            ? { clipId, projectId: id, created: target === 'new' }
            : x,
        ),
    );
  };

  /**
   * Puts freshly uploaded clips into the project the person was looking at, instead of letting the
   * automatic grouping decide. Safe to call before or after the automatic placement has run.
   */
  const adopt = useCallback((clipIds: string[], target: string) => {
    const moving = new Set(clipIds);
    setProjects((ps) => {
      if (!ps.some((p) => p.id === target)) return ps;
      // the example is read-only: nothing is added to it, and its own clips are never taken out of it
      if (ps.some((p) => p.id === target && p.locked)) return ps;
      const frozen = new Set(ps.filter((p) => p.locked).flatMap((p) => p.clipIds));
      const ids = clipIds.filter((id) => !frozen.has(id));
      if (!ids.length) return ps;
      const going = new Set(ids);
      return ps
        .map((p) =>
          p.id === target
            ? {
                ...p,
                clipIds: [
                  ...p.clipIds,
                  ...ids.filter((id) => !p.clipIds.includes(id)),
                ],
              }
            : { ...p, clipIds: p.clipIds.filter((id) => !going.has(id)) },
        )
        .filter((p) => p.clipIds.length || p.manual);
    });
    // the person chose the destination, so the "where did it go?" toast is not needed
    setNotice((n) => {
      const rest = n?.filter((x) => !moving.has(x.clipId));
      return rest?.length ? rest : null;
    });
  }, []);

  /** '' (or the generated name) resets to the generated name. */
  const rename = (id: string, name: string) =>
    setProjects((ps) =>
      ps.some((p) => p.id === id && p.locked) // the example keeps its name
        ? ps
        : ps.map((p) =>
            p.id === id ? { ...p, name: name.trim() || undefined } : p,
          ),
    );

  const dismissNotice = useCallback(() => setNotice(null), []);

  /** Creates an empty project with a random name; returns its id. */
  const createProject = () => {
    const id = `manual-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setProjects((ps) => [
      ...ps,
      { id, clipIds: [], manual: true, title: suggestName(namesOf(projects)) },
    ]);
    return id;
  };

  /**
   * Creates the read-only example project in ONE update: named, filled, locked. The clips are taken out of
   * whatever project the automatic grouping may have put them in first. Returns its id.
   */
  const createLockedProject = (name: string, clipIds: string[]) => {
    const id = `manual-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const going = new Set(clipIds);
    setProjects((ps) => [
      ...ps
        .map((p) => ({
          ...p,
          clipIds: p.clipIds.filter((c) => !going.has(c)),
        }))
        .filter((p) => p.clipIds.length || p.manual),
      {
        id,
        clipIds,
        manual: true,
        locked: true,
        title: pickTitle(id, namesOf(ps)),
        name: name.trim() || undefined,
      },
    ]);
    setNotice((n) => {
      const rest = n?.filter((x) => !going.has(x.clipId));
      return rest?.length ? rest : null;
    });
    return id;
  };

  /** Removes the project itself. Deleting its clips is the caller's job. */
  const removeProject = (id: string) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    setNotice((n) => {
      const rest = n?.filter((x) => x.projectId !== id);
      return rest?.length ? rest : null;
    });
  };

  return {
    views,
    projectOf,
    /** clip id → place name ('' = looked up, nothing found; missing = not yet) */
    clipPlace,
    notice,
    dismissNotice,
    moveClip,
    adopt,
    rename,
    createProject,
    createLockedProject,
    lockedClips,
    removeProject,
  };
}
