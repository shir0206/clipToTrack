import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { Clip } from './types';
import ClipCard from './ClipCard';
import TrackMap, { type MapApi } from './TrackMap';
import UploadZone from './UploadZone';
import Logo from './Logo';
import VideoModal from './VideoModal';
import VideoWindow, { openVideoWindow } from './VideoWindow';
import SvgIcon, { type IconName } from './SvgIcon';
import SettingsDialog from './SettingsDialog';
import PlaybackHelp, { playbackHelpDismissed } from './PlaybackHelp';
import { probeDecode } from './videoSupport';
import { useClips } from './useClips';
import { useProjects } from './useProjects';
import { ProjectBar, ProjectNotice, ProjectsDialog } from './ProjectsUI';
import './ClipToTrack.css';

const WIDTH_KEY = 'clip-to-track:panel-width';
const PROFILE_HEIGHT_KEY = 'clip-to-track:profile-height'; // owned by ElevationProfile
const SORT_KEY = 'clip-to-track:sort';

type SortKey = 'added' | 'name' | 'date' | 'duration' | 'distance' | 'speed';
const SORTS: [SortKey, string, IconName][] = [
  ['added', 'Uploaded', 'upload'],
  ['name', 'Name', 'type'],
  ['date', 'Date', 'calendar'],
  ['duration', 'Duration', 'clock'],
  ['distance', 'Distance', 'route'],
  ['speed', 'Max speed', 'gauge'],
];
const value = (c: Clip, k: SortKey): number | string | undefined =>
  k === 'added' ? c.addedAt : k === 'name' ? c.title : c.sort[k];
const loadSort = (): { key: SortKey; dir: 1 | -1 } => {
  try {
    const s = JSON.parse(localStorage.getItem(SORT_KEY) ?? '');
    if (SORTS.some(([k]) => k === s.key))
      return { key: s.key, dir: s.dir === -1 ? -1 : 1 };
  } catch {
    /* default */
  }
  return { key: 'added', dir: 1 };
};

const MIN_W = 320; // card needs room
const MIN_MAP = 280;
const clampW = (w: number) =>
  Math.round(
    Math.min(Math.max(w, MIN_W), Math.max(MIN_W, window.innerWidth - MIN_MAP)),
  );

export default function ClipToTrack() {
  const { clips, error, busy, progress, addFiles, remove, clear } = useClips(); // clips persist in localStorage
  const projects = useProjects(clips); // every clip is placed in a project automatically
  const [projectFilter, setProjectFilter] = useState('all');
  const [projectsDialog, setProjectsDialog] = useState<{ id?: string } | null>(
    null,
  );
  const [dragClipId, setDragClipId] = useState<string | null>(null); // a card is being dragged
  const activeProject = projects.views.some((v) => v.id === projectFilter)
    ? projectFilter
    : 'all';
  // clips not placed yet (a render-phase transient) stay visible
  const visible = useMemo(
    () =>
      activeProject === 'all'
        ? clips
        : clips.filter((c) => {
            const p = projects.projectOf.get(c.id);
            return !p || p === activeProject;
          }),
    [clips, activeProject, projects.projectOf],
  );
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    clips[0]?.id ?? null,
  ); // single source of truth
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [maxClipId, setMaxClipId] = useState<string | null>(null);
  const [maxPlaying, setMaxPlaying] = useState(false); // is the large player (popup / modal) actually playing?
  const [videoWin, setVideoWin] = useState<Window | null>(null); // popup window; null => in-page modal fallback
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set()); // hidden on the map only
  const [sort, setSort] = useState(loadSort);
  const [playbackHelp, setPlaybackHelp] = useState(false); // browser can't draw the video's picture
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mapApi = useRef<MapApi | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    } catch {
      /* ignore */
    }
  }, [sort]);

  // Sorting only changes the list order. Clip.index / colour stay tied to upload order, so the map never recolours.
  const sorted = useMemo(
    () =>
      [...visible].sort((a, b) => {
        const x = value(a, sort.key);
        const y = value(b, sort.key);
        if (x === undefined) return y === undefined ? 0 : 1; // missing values always last
        if (y === undefined) return -1;
        const r =
          typeof x === 'string'
            ? x.localeCompare(y as string, undefined, {
                numeric: true,
                sensitivity: 'base',
              })
            : x - (y as number);
        // ties fall back to upload order, and flip with the direction so the toggle always visibly does something
        return (r || a.index - b.index) * sort.dir;
      }),
    [visible, sort],
  );
  const mapClips = useMemo(
    () => visible.filter((c) => !hiddenIds.has(c.id)),
    [visible, hiddenIds],
  );
  const toggleHidden = (id: string) =>
    setHiddenIds((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const [panelW, setPanelW] = useState(() =>
    clampW(Number(localStorage.getItem(WIDTH_KEY)) || window.innerWidth * 0.33),
  );
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(panelW));
    } catch {
      /* ignore */
    }
  }, [panelW]);
  useEffect(() => {
    const onResize = () => setPanelW((w) => clampW(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onDragStart = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onDragMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      setPanelW(clampW(e.clientX));
  };
  const onDragEnd = () => setDragging(false);
  const onResizerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setPanelW((w) => clampW(w - 24));
    else if (e.key === 'ArrowRight') setPanelW((w) => clampW(w + 24));
    else return;
    e.preventDefault();
  };

  const select = (id: string) => {
    setSelectedClipId(id);
    document
      .getElementById(`ctt-${id}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const handleFiles = async (files: File[]) => {
    // in parallel with the import: can this browser draw the picture? If not, explain (once) what to approve
    const video = files.find((f) => !/\.json$/i.test(f.name));
    if (video && !playbackHelpDismissed())
      void probeDecode(video).then(
        (r) => r === 'no-picture' && setPlaybackHelp(true),
      );
    const firstId = await addFiles(files);
    if (!firstId) return;
    setSelectedClipId(firstId);
    setTimeout(() => select(firstId), 0); // scroll the new card into view after render
  };

  const closeMax = () => {
    if (videoWin && !videoWin.closed) videoWin.close();
    setVideoWin(null);
    setMaxClipId(null);
    setMaxPlaying(false);
  };
  const openMax = (clip: Clip) => {
    if (videoWin && !videoWin.closed) videoWin.close(); // replaces any popup already open
    const win = openVideoWindow(clip.title); // must run synchronously inside the click
    setVideoWin(win); // null (popup blocked) falls back to the modal
    setPlayingClipId(null); // the large player takes over
    setSelectedClipId(clip.id);
    setMaxClipId(clip.id);
  };

  const handleDelete = (id: string) => {
    if (playingClipId === id) setPlayingClipId(null);
    if (maxClipId === id) closeMax();
    if (selectedClipId === id) setSelectedClipId(null);
    setHoveredClipId(null); // the card unmounts, so its mouseleave will never fire
    setHiddenIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    mapApi.current?.setPlayhead(id, null);
    remove(id); // -> map layers, pinned bubble and localStorage all follow from `clips`
  };

  const handleClear = () => {
    setPlayingClipId(null);
    closeMax();
    setHiddenIds(new Set());
    setSelectedClipId(null);
    clear();
  };

  const maxClip = clips.find((c) => c.id === maxClipId && c.videoUrl);

  return (
    <div className={`ctt-app${dragging ? ' is-resizing' : ''}`}>
      <header className="ctt-header">
        <Logo tagline="GoPro clips. Mapped to your adventures." />
        <div className="ctt-header-actions">
          <button
            onClick={() =>
              setProjectsDialog({
                id: activeProject === 'all' ? undefined : activeProject,
              })
            }
          >
            Projects
          </button>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>

      <main className="ctt-layout">
        <aside className="ctt-panel" style={{ width: panelW }}>
          <div className="ctt-panel-title">
            Clips{' '}
            <span>
              {clips.length > 0 && (
                <button className="ctt-link" onClick={handleClear}>
                  <SvgIcon name="trash" size={13} />
                  Clear all
                </button>
              )}
              {visible.length}
            </span>
          </div>
          <ProjectBar
            views={projects.views}
            total={clips.length}
            activeId={activeProject}
            dragging={dragClipId !== null}
            onChange={setProjectFilter}
            onRename={projects.rename}
            onManage={(id) => setProjectsDialog({ id })}
            onDropClip={(clipId, target) => {
              projects.moveClip(clipId, target);
              setDragClipId(null);
            }}
          />
          <div className="ctt-sort" role="group" aria-label="Sort clips">
            <span className="ctt-sort-label">Sort</span>
            <div className="ctt-sort-chips">
              {SORTS.map(([k, label, icon]) => {
                const on = sort.key === k;
                const asc = sort.dir === 1;
                return (
                  <button
                    key={k}
                    className={`ctt-sort-chip${on ? ' is-on' : ''}`}
                    disabled={visible.length < 2}
                    aria-pressed={on}
                    title={
                      on
                        ? `${label}: ${asc ? 'ascending' : 'descending'} — click to reverse`
                        : `Sort by ${label.toLowerCase()}`
                    }
                    onClick={() =>
                      setSort(
                        on
                          ? { key: k, dir: asc ? -1 : 1 }
                          : {
                              key: k,
                              dir: k === 'name' || k === 'added' ? 1 : -1,
                            },
                      )
                    }
                  >
                    <SvgIcon name={icon} size={13} />
                    {label}
                    {on && (
                      <SvgIcon
                        name={asc ? 'arrowUp' : 'arrowDown'}
                        size={12}
                        className="ctt-sort-dir"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <ul className="ctt-list" role="listbox" aria-label="Clips">
            {sorted.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                selected={clip.id === selectedClipId}
                playing={clip.id === playingClipId}
                nowPlaying={clip.id === maxClipId && maxPlaying}
                onSelect={() => select(clip.id)}
                onHover={(h) => setHoveredClipId(h ? clip.id : null)}
                onTogglePlay={() => {
                  setSelectedClipId(clip.id);
                  setPlayingClipId((p) => (p === clip.id ? null : clip.id));
                }}
                onStop={() => setPlayingClipId(null)}
                hidden={hiddenIds.has(clip.id)}
                onToggleHidden={() => toggleHidden(clip.id)}
                onProgress={(f) => mapApi.current?.setPlayhead(clip.id, f)}
                onDelete={() => handleDelete(clip.id)}
                onDragStart={() => setDragClipId(clip.id)}
                onDragEnd={() => setDragClipId(null)}
                onMaximize={() => openMax(clip)}
              />
            ))}
          </ul>
          {error && (
            <p className="ctt-error" role="alert">
              Couldn’t load {error}
            </p>
          )}
          {projects.notice && (
            <ProjectNotice
              items={projects.notice}
              views={projects.views}
              clips={clips}
              activeId={activeProject}
              onMove={projects.moveClip}
              onOpen={setProjectFilter}
              onDismiss={projects.dismissNotice}
            />
          )}
          <UploadZone onFiles={handleFiles} busy={busy} progress={progress} />
        </aside>

        <div
          className={`ctt-resizer${dragging ? ' is-dragging' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={panelW}
          aria-valuemin={MIN_W}
          tabIndex={0}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onKeyDown={onResizerKey}
          onDoubleClick={() => setPanelW(clampW(window.innerWidth * 0.33))}
        />

        <section className="ctt-map-wrap">
          <TrackMap
            clips={mapClips}
            apiRef={mapApi}
            selectedId={selectedClipId}
            hoveredId={hoveredClipId}
            onSelect={select}
            onHover={setHoveredClipId}
          />
          {clips.length === 0 && (
            <div className="ctt-empty">
              <h2>No tracks yet</h2>
              <p>Drop a GoPro MP4 to map your adventure.</p>
            </div>
          )}
        </section>
      </main>

      {projectsDialog && (
        <ProjectsDialog
          views={projects.views}
          clips={clips}
          initialId={projectsDialog.id}
          onRename={projects.rename}
          onMove={projects.moveClip}
          onOpen={(id) => {
            setProjectFilter(id);
            setProjectsDialog(null);
          }}
          onClose={() => setProjectsDialog(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          clipCount={clips.length}
          layoutIsDefault={
            panelW === clampW(window.innerWidth * 0.33) &&
            [null, '260'].includes(localStorage.getItem(PROFILE_HEIGHT_KEY)) // 260 = ElevationProfile's DEFAULT_H
          }
          onClose={() => setSettingsOpen(false)}
          onResetLayout={() => {
            setPanelW(clampW(window.innerWidth * 0.33));
            try {
              localStorage.removeItem(PROFILE_HEIGHT_KEY); // applied next time the dock opens
            } catch {
              /* ignore */
            }
          }}
          onClearClips={() => {
            handleClear();
            setSettingsOpen(false);
          }}
        />
      )}

      {playbackHelp && <PlaybackHelp onClose={() => setPlaybackHelp(false)} />}

      {maxClip &&
        (videoWin ? (
          <VideoWindow
            key={maxClip.id}
            clip={maxClip}
            win={videoWin}
            onClose={closeMax}
            onPlayingChange={setMaxPlaying}
            onProgress={(f) => mapApi.current?.setPlayhead(maxClip.id, f)}
          />
        ) : (
          <VideoModal
            clip={maxClip}
            onClose={closeMax}
            onPlayingChange={setMaxPlaying}
            onProgress={(f) => mapApi.current?.setPlayhead(maxClip.id, f)}
          />
        ))}
    </div>
  );
}
