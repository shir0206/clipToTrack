import { useCallback, useEffect, useRef, useState } from 'react';
import type { Clip } from '../types';
import type { useProjects } from './useProjects';
import {
  exampleState,
  loadExampleClips,
  randomExampleName,
  setExampleState,
  useExampleState,
  type ExampleClip,
} from '../components/exampleProject';

type Projects = ReturnType<typeof useProjects>;

export type ExampleStatus =
  | { phase: 'idle' }
  | { phase: 'importing' }
  /** `partial`: the example was added, but some of its files are missing */
  | { phase: 'error'; message: string; partial?: boolean };

type Args = {
  clips: Clip[];
  /** useClips().addPrepared: adds clips from ready-made metadata (no file parsing) */
  addPrepared: (items: ExampleClip[]) => string[];
  /** useClips().attachVideo: gives a saved clip its video back */
  attachVideo: (id: string, src: File | string) => void;
  /** removes one clip everywhere (map, selection, storage) */
  removeClip: (id: string) => void;
  projects: Projects;
  /** called once the example is in place, so the app can open it */
  onAdded?: (projectId: string, clipIds: string[]) => void;
};

/**
 * Adds / removes the example project (see components/exampleProject.ts and PLAN.md).
 *  - first visit with an empty library: added automatically (unless the Settings switch is off)
 *  - Settings switch on: added now; off: its clips (and the project, if nothing else is in it) are removed
 *  - after a reload the saved clips have lost their video URL (it is session-only), so the static
 *    video URLs are re-attached
 */
export function useExampleProject({
  clips,
  addPrepared,
  attachVideo,
  removeClip,
  projects,
  onAdded,
}: Args) {
  const saved = useExampleState();
  const [status, setStatus] = useState<ExampleStatus>({ phase: 'idle' });
  const busy = useRef(false);
  // the async work below outlives renders: always read the newest callbacks
  const latest = useRef({
    addPrepared,
    attachVideo,
    removeClip,
    projects,
    onAdded,
  });
  useEffect(() => {
    latest.current = { addPrepared, attachVideo, removeClip, projects, onAdded };
  });

  const install = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setExampleState({ enabled: true });
    try {
      setStatus({ phase: 'importing' });
      const { clips: items, missing } = await loadExampleClips();
      if (!items.length)
        throw new Error(
          `The example files are missing: ${missing.join(', ') || 'none found'}.`,
        );
      const ids = latest.current.addPrepared(items); // ids come back in item order

      // these updates are queued in order, so the project exists by the time it is renamed and filled
      const p = latest.current.projects;
      const projectId = p.createProject();
      p.rename(projectId, randomExampleName());
      p.adopt(ids, projectId);
      const videos: Record<string, string> = {};
      ids.forEach((id, i) => {
        const url = items[i].videoUrl;
        if (url) videos[id] = url;
      });
      setExampleState({ projectId, clipIds: ids, videos });
      latest.current.onAdded?.(projectId, ids);
      setStatus(
        missing.length
          ? {
              phase: 'error',
              partial: true,
              message: `Added, but these files are missing: ${missing.join(', ')}`,
            }
          : { phase: 'idle' },
      );
    } catch (e) {
      setStatus({
        phase: 'error',
        message:
          e instanceof Error
            ? e.message
            : 'Could not load the example project.',
      });
    } finally {
      busy.current = false;
    }
  }, []);

  const uninstall = useCallback(() => {
    const { projects: p, removeClip: remove } = latest.current;
    const { projectId, clipIds } = exampleState();
    // only the example's own clips: anything the user moved into the project stays
    const others = p.views
      .find((v) => v.id === projectId)
      ?.clipIds.filter((id) => !clipIds.includes(id));
    clipIds.forEach(remove);
    if (projectId && !others?.length) p.removeProject(projectId);
    setExampleState({
      enabled: false,
      projectId: null,
      clipIds: [],
      videos: {},
    });
    setStatus({ phase: 'idle' });
  }, []);

  /** After a reload: hand the static video URLs back to the saved clips. */
  const restore = useCallback(() => {
    const { clipIds, videos } = exampleState();
    clipIds.forEach((id) => {
      if (videos[id]) latest.current.attachVideo(id, videos[id]);
    });
  }, []);

  // once, on mount
  useEffect(() => {
    const { enabled, projectId, clipIds } = exampleState();
    if (enabled && !projectId && clips.length === 0) {
      queueMicrotask(() => void install());
    } else if (
      projectId &&
      clips.some((c) => clipIds.includes(c.id) && !c.videoUrl)
    ) {
      queueMicrotask(restore);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const working = status.phase === 'importing';
  // the switch shows what is really there: deleting the project by hand turns it off
  const present =
    !!saved.projectId && projects.views.some((v) => v.id === saved.projectId);

  return {
    enabled: present || working,
    busy: working,
    status,
    setEnabled: (on: boolean) => (on ? void install() : uninstall()),
    dismiss: () => setStatus({ phase: 'idle' }),
  };
}
