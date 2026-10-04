import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Clip } from './types';
import {
  assign,
  namesOf,
  newProjectId,
  pickTitle,
  projectViews,
  UNDATED_ID,
  type Placement,
  type Project,
} from './projects';

const KEY = 'clip-to-track:projects:v1';

function load(): Project[] {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(arr)
      ? (arr as Project[]).filter((p) => p && p.id && Array.isArray(p.clipIds))
      : [];
  } catch {
    return [];
  }
}

/**
 * Keeps every clip in a project, automatically. Pass the current clips; the hook assigns new ones
 * (during render, so the first paint is already consistent) and reports where uploads landed.
 */
export function useProjects(clips: Clip[]) {
  const [projects, setProjects] = useState<Project[]>(load);
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

  // name each new project after its place (Nominatim, one request per second at most)
  const asked = useRef(new Set<string>());
  const busy = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (busy.current) return;
    const p = projects.find(
      (x) =>
        x.place === undefined &&
        x.id !== UNDATED_ID &&
        !asked.current.has(x.id),
    );
    const clip = p && clips.find((c) => c.id === p.clipIds[0]);
    if (!p || !clip) return;
    asked.current.add(p.id);
    busy.current = true;
    const [lon, lat] = clip.coordinates[0];
    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`,
    )
      .then((res) => res.json())
      .then((j) => {
        const a = j?.address ?? {};
        const place: string =
          a.city ||
          a.town ||
          a.village ||
          a.municipality ||
          a.county ||
          a.state ||
          '';
        setProjects((ps) =>
          ps.map((x) => (x.id === p.id ? { ...x, place } : x)),
        );
      })
      .catch(() => {
        /* offline: tried once this session; retried on the next visit */
      })
      .finally(() =>
        setTimeout(() => {
          busy.current = false;
          setTick((t) => t + 1);
        }, 1100),
      );
  }, [projects, clips, tick]);

  const views = useMemo(() => projectViews(projects, clips), [projects, clips]);
  const projectOf = useMemo(
    () =>
      new Map(
        projects.flatMap((p) => p.clipIds.map((id) => [id, p.id] as const)),
      ),
    [projects],
  );

  /** Move a clip to another project, or to a brand-new one ('new'). */
  const moveClip = (clipId: string, target: string | 'new') => {
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
    setProjects(next.filter((p) => p.clipIds.length));
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

  const rename = (id: string, name: string) =>
    setProjects((ps) =>
      ps.map((p) =>
        p.id === id ? { ...p, name: name.trim() || undefined } : p,
      ),
    );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { views, projectOf, notice, dismissNotice, moveClip, rename };
}
