import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { Clip } from '../../types';
import ClipCard from '../ClipCard/ClipCard';
import TrackMap, { type MapApi } from '../TrackMap/TrackMap';
import UploadZone from '../UploadZone/UploadZone';
import Logo from '../logo/Logo';
import VideoModal from '../VideoModal/VideoModal';
import VideoWindow, { openVideoWindow } from '../VideoWindow/VideoWindow';
import Icon, { type IconName } from '../Icon/Icon';
import Settings from '../Settings/Settings';
import { SheetPeek, OtherClips } from '../SheetPeek/SheetPeek';
import { useLayoutMode } from '../../hooks/useLayoutMode';
import { useBottomSheet, type Snap } from '../../hooks/useBottomSheet';
import PlaybackHelp, { playbackHelpDismissed } from '../playback/PlaybackHelp';
import { probeDecode } from '../../lib/video/videoSupport';
import { useClips } from '../../hooks/useClips';
import { useProjectMode, useProjects } from '../../hooks/useProjects';
import { useExampleProject } from '../ExampleProject/useExampleProject';
import { useExampleUploadPrompt } from '../ExampleProject/useExampleUploadPrompt';
import {
  exampleState,
  useExampleState,
} from '../ExampleProject/exampleProject';
import {
  ProjectBar,
  ProjectNotice,
  ProjectPicker,
  ProjectsModal,
} from '../ProjectsModal/ProjectsModal';
import ExampleStatus from '../ExampleProject/ExampleStatus';
import './ClipToTrack.css';
import './ClipToTrack.mobile.css'; // after the desktop rules: it only overrides under [data-layout^='mobile'] / pointer: coarse
import './ClipToTrack.ux.css'; // phone type scale, tap sizes, video and telemetry heights

const WIDTH_KEY = 'clip-to-track:panel-width';
const PROFILE_HEIGHT_KEY = 'clip-to-track:profile-height'; // owned by ElevationProfile
const SORT_KEY = 'clip-to-track:sort';

type SortKey = 'added' | 'name' | 'date' | 'location' | 'speed';
const SORTS: [SortKey, string, IconName][] = [
  ['added', 'Uploaded', 'upload'],
  ['name', 'Name', 'type'],
  ['date', 'Date', 'calendar'],
  ['location', 'Location', 'gps'],
  ['speed', 'Max speed', 'gauge'],
];
const value = (
  c: Clip,
  k: SortKey,
  place?: string,
): number | string | undefined =>
  k === 'added'
    ? c.addedAt
    : k === 'name'
      ? c.title
      : k === 'location'
        ? place || undefined // not looked up yet / nothing found: sorts last
        : c.sort[k];
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
  const {
    clips,
    error,
    busy,
    progress,
    addFiles,
    addPrepared,
    attachVideo,
    remove,
    clear,
  } = useClips(); // clips persist in localStorage
  const layout = useLayoutMode();
  const isMobile = layout !== 'desktop';
  const sheetOn = layout === 'mobile'; // landscape phones use a plain side panel, no snap points
  const {
    ref: sheetRef,
    snap,
    setSnap,
    cycle: cycleSheet,
    visiblePx: sheetVisiblePx,
    dragging: sheetDragging,
    handleProps: sheetHandleProps,
  } = useBottomSheet({
    enabled: sheetOn,
    lock: clips.length === 0 ? 'half' : undefined, // empty: the upload zone must stay reachable
  });
  const collapsed = sheetOn && snap === 'collapsed';
  const projects = useProjects(clips); // every clip is placed in a project automatically
  const projectMode = useProjectMode(); // Settings → "Group clips into projects"; off = plain clip list
  const [projectFilter, setProjectFilter] = useState('all');
  const [projectsDialog, setProjectsModal] = useState<{ id?: string } | null>(
    null,
  );
  const [dragClipId, setDragClipId] = useState<string | null>(null); // a card is being dragged
  const activeProject =
    projectMode && projects.views.some((v) => v.id === projectFilter)
      ? projectFilter
      : 'all';
  // "All" leaves the example clips out as soon as the person has clips of their own
  // (with only the example around, "All" shows it). The example stays reachable as a project.
  const exampleClipIds = useExampleState().clipIds;
  const hideExamples =
    exampleClipIds.length > 0 &&
    clips.some((c) => !exampleClipIds.includes(c.id));
  // clips not placed yet (a render-phase transient) stay visible
  const visible = useMemo(
    () =>
      activeProject === 'all'
        ? hideExamples
          ? clips.filter((c) => !exampleClipIds.includes(c.id))
          : clips
        : clips.filter((c) => {
            const p = projects.projectOf.get(c.id);
            return !p || p === activeProject;
          }),
    [clips, activeProject, projects.projectOf, hideExamples, exampleClipIds],
  );
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    () =>
      (clips.find((c) => !exampleState().clipIds.includes(c.id)) ?? clips[0])
        ?.id ?? null,
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
  const { ask: askExampleUpload, prompt: examplePrompt } =
    useExampleUploadPrompt();
  // after an 'auto' upload: the clip to jump to once the automatic grouping has placed it
  const landOn = useRef<string[] | null>(null);
  const [landTick, setLandTick] = useState(0);
  const mapApi = useRef<MapApi | null>(null);
  const [profileHost, setProfileHost] = useState<HTMLDivElement | null>(null); // telemetry portal target (phones)
  const [picker, setPicker] = useState<
    null | { kind: 'switch' } | { kind: 'move'; clipId: string }
  >(null);
  const [immersive, setImmersive] = useState(false); // phones: map only, no chrome
  const peekBar = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const beforeSearch = useRef<Snap | null>(null);

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
        const x = value(a, sort.key, projects.clipPlace[a.id]);
        const y = value(b, sort.key, projects.clipPlace[b.id]);
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
    [visible, sort, projects.clipPlace],
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
    if (isMobile) return; // a 390px phone would clamp to 320 and overwrite the saved desktop width
    try {
      localStorage.setItem(WIDTH_KEY, String(panelW));
    } catch {
      /* ignore */
    }
  }, [panelW, isMobile]);
  useEffect(() => {
    if (isMobile) return;
    const onResize = () => setPanelW((w) => clampW(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isMobile]);

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

  /**
   * `fromMap`: a tap on a route / dot. On phones that opens the half sheet; a tap on a card that
   * is already selected leaves the sheet alone.
   */
  const select = (id: string, fromMap = false) => {
    if (sheetOn && (fromMap || id !== selectedClipId)) {
      setSnap('half');
      bodyRef.current?.scrollTo({ top: 0 });
    }
    setSelectedClipId(id);
    const card = document.getElementById(`ctt-${id}`);
    if (!card) return;
    if (sheetOn) {
      const scroller = bodyRef.current;
      const layoutEl = scroller?.closest('.app-layout') as HTMLElement | null;
      if (scroller) {
        const cardRect = card.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        scroller.scrollTo({
          top: Math.max(
            0,
            scroller.scrollTop + cardRect.top - scrollerRect.top - 8,
          ),
          behavior: 'smooth',
        });
      }
      layoutEl?.scrollTo({ top: 0, left: 0 });
      return;
    }
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const selectFromMap = (id: string) => select(id, true);
  // tap on empty map: step the sheet down one snap
  const onBackgroundTap = useCallback(() => {
    if (!sheetOn || clips.length === 0) return;
    setSnap(snap === 'expanded' ? 'half' : 'collapsed');
  }, [sheetOn, clips.length, snap, setSnap]);
  // the keyboard needs the room: collapse while searching, restore afterwards
  const onSearchFocus = useCallback(
    (focused: boolean) => {
      if (!sheetOn || clips.length === 0) return;
      if (focused) {
        beforeSearch.current = snap;
        setSnap('collapsed');
      } else if (beforeSearch.current) {
        setSnap(beforeSearch.current);
        beforeSearch.current = null;
      }
    },
    [sheetOn, clips.length, snap, setSnap],
  );
  /** playhead: map dot + the peek bar's progress line */
  const onFrac = (clipId: string, f: number | null) => {
    mapApi.current?.setPlayhead(clipId, f);
    const bar = peekBar.current;
    if (bar) bar.style.transform = `scaleX(${f ?? 0})`;
  };

  /** `into`: a project chosen explicitly (the Projects dialog); otherwise the open project, if any */
  const handleFiles = async (files: File[], into?: string) => {
    // an upload made while a project is open belongs to that project (not to the automatic grouping)
    let target =
      into ?? (projectMode && activeProject !== 'all' ? activeProject : null);
    // looking at the example project? offer a project of their own first
    const choice = await askExampleUpload(target);
    if (choice === 'cancel') return;
    if (choice === 'auto') target = null; // the automatic grouping places the clips
    // in parallel with the import: can this browser draw the picture? If not, explain (once) what to approve
    const video = files.find((f) => !/\.json$/i.test(f.name));
    if (video && !playbackHelpDismissed())
      void probeDecode(video).then(
        (r) => r === 'no-picture' && setPlaybackHelp(true),
      );
    const ids = await addFiles(files);
    if (!ids.length) return;
    if (target) projects.adopt(ids, target);
    if (choice === 'auto') {
      landOn.current = ids; // handled by the effect below, once the automatic grouping has run
      setLandTick((t) => t + 1);
      return;
    }
    const firstId = ids[0];
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
    // phones: window.open gives a new tab, not null, so the modal must be forced
    const win = isMobile ? null : openVideoWindow(clip.title); // must run synchronously inside the click
    setVideoWin(win); // null (popup blocked / phone) falls back to the modal
    setPlayingClipId(null); // the large player takes over
    setSelectedClipId(clip.id);
    setMaxClipId(clip.id);
  };

  const handleDelete = (id: string) => {
    if (playingClipId === id) setPlayingClipId(null);
    if (maxClipId === id) closeMax();
    if (selectedClipId === id) {
      setSelectedClipId(null);
      if (sheetOn) setSnap(clips.length <= 1 ? 'collapsed' : 'expanded');
    }
    setHoveredClipId(null); // the card unmounts, so its mouseleave will never fire
    setHiddenIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    onFrac(id, null);
    remove(id); // -> map layers, pinned bubble and localStorage all follow from `clips`
  };

  // 'auto' upload from the example: open the project the new clips landed in
  useEffect(() => {
    const ids = landOn.current;
    if (!ids?.length || !ids.every((i) => projects.projectOf.has(i))) return;
    landOn.current = null;
    // the person chose "New Project": whatever the automatic grouping did, the clips must not stay in the example
    const exampleId = exampleState().projectId;
    const stuck = ids.filter((i) => projects.projectOf.get(i) === exampleId);
    let dest = projects.projectOf.get(ids[0])!;
    if (stuck.length) {
      dest = projects.createProject();
      projects.adopt(stuck, dest);
    }

    setProjectFilter(dest);
    setSelectedClipId(ids[0]);
    setTimeout(() => select(ids[0]), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.projectOf, landTick]);

  // a project owns its clips: deleting it removes them too (the UI asks for confirmation first)
  const handleDeleteProject = (id: string) => {
    const ids = projects.views.find((v) => v.id === id)?.clipIds ?? [];
    ids.forEach(handleDelete);
    projects.removeProject(id);
    if (projectFilter === id) setProjectFilter('all');
  };

  // the example project: added on the first visit, switched on / off in Settings
  const example = useExampleProject({
    clips,
    addPrepared,
    attachVideo,
    removeClip: handleDelete,
    projects,
    onAdded: (projectId, ids) => {
      setProjectFilter(projectId);
      setSelectedClipId(ids[0]);
      setTimeout(() => select(ids[0]), 0);
    },
  });

  // content that is off-screen must not be reachable by Tab or a screen reader
  useEffect(() => {
    bodyRef.current?.toggleAttribute('inert', collapsed);
  }, [collapsed]);

  const handleClear = () => {
    setPlayingClipId(null);
    closeMax();
    setHiddenIds(new Set());
    setSelectedClipId(null);
    clear();
  };

  const maxClip = clips.find((c) => c.id === maxClipId && c.videoUrl);
  // peek bar: what you hear is what you see, so a playing clip wins over the selection
  const peekClip =
    clips.find((c) => c.id === playingClipId) ??
    clips.find((c) => c.id === selectedClipId);
  const projectLabel =
    !projectMode || activeProject === 'all'
      ? projectMode
        ? 'All projects'
        : `Clips · ${visible.length}`
      : (projects.views.find((v) => v.id === activeProject)?.name ?? 'Project');
  const addPicked = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((x) =>
      /\.(mp4|lrv|json)$/i.test(x.name),
    );
    if (files.length) void handleFiles(files);
    if (addInput.current) addInput.current.value = '';
  };

  const emptyProject =
    projectMode && activeProject !== 'all' && visible.length === 0;
  const upload = (
    <UploadZone onFiles={handleFiles} busy={busy} progress={progress} />
  );
  // sort bar + cards: inside the project container when a project is open, plain otherwise
  const panelBody = (
    <>
      {!emptyProject && (
        <div className="sort-bar" role="group" aria-label="Sort clips">
          <span className="sort-label">Sort</span>
          <div className="sort-chips">
            {SORTS.map(([k, label, icon]) => {
              const on = sort.key === k;
              const asc = sort.dir === 1;
              return (
                <button
                  key={k}
                  className={`sort-chip${on ? ' is-on' : ''}`}
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
                            dir:
                              k === 'name' || k === 'added' || k === 'location'
                                ? 1
                                : -1,
                          },
                    )
                  }
                >
                  <Icon name={icon} size={13} />
                  {label}
                  {on && (
                    <Icon
                      name={asc ? 'arrowUp' : 'arrowDown'}
                      size={12}
                      className="sort-direction"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {emptyProject ? (
        <div className="project-empty">
          <p>
            This project is empty. Drop GoPro clips here and they’ll be added to
            it.
          </p>
          {upload}
        </div>
      ) : (
        <ul className="plain-list" role="listbox" aria-label="Clips">
          {sorted.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              place={projects.clipPlace[clip.id]}
              selected={clip.id === selectedClipId}
              playing={clip.id === playingClipId}
              nowPlaying={clip.id === maxClipId && maxPlaying}
              layout={isMobile ? 'stacked' : 'row'}
              onSelect={() => select(clip.id)}
              // touch emulates mouse events and never sends mouseleave: a stuck highlight
              onHover={(h) => !isMobile && setHoveredClipId(h ? clip.id : null)}
              onMove={
                isMobile
                  ? () => setPicker({ kind: 'move', clipId: clip.id })
                  : undefined
              }
              onHelp={isMobile ? () => setPlaybackHelp(true) : undefined}
              onTogglePlay={() => {
                setSelectedClipId(clip.id);
                setPlayingClipId((p) => (p === clip.id ? null : clip.id));
              }}
              onStop={() => setPlayingClipId(null)}
              hidden={hiddenIds.has(clip.id)}
              onToggleHidden={() => toggleHidden(clip.id)}
              onProgress={(f) => onFrac(clip.id, f)}
              onDelete={() => handleDelete(clip.id)}
              onDragStart={isMobile ? undefined : () => setDragClipId(clip.id)}
              onDragEnd={isMobile ? undefined : () => setDragClipId(null)}
              onMaximize={() => openMax(clip)}
            />
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div
      className={`app-shell${dragging ? ' is-resizing' : ''}${immersive ? ' is-immersive' : ''}`}
      data-layout={layout}
      data-snap={sheetOn ? snap : undefined}
      data-empty={clips.length === 0 || undefined}
      style={{ '--sheet-visible': `${sheetVisiblePx}px` } as CSSProperties}
    >
      <header className="app-header">
        <Logo
          compact={isMobile}
          tagline="GoPro clips. Mapped to your adventures."
        />
        {isMobile && (
          <button
            className="mobile-project"
            disabled={!projectMode}
            aria-haspopup={projectMode ? 'dialog' : undefined}
            onClick={() => setPicker({ kind: 'switch' })}
          >
            <span>{projectLabel}</span>
            {projectMode && <Icon name="chevron" size={13} />}
          </button>
        )}
        <div className="header-actions">
          {projectMode && !isMobile && (
            <button
              onClick={() =>
                setProjectsModal({
                  // no project open: start on the example (if it is switched on in Settings)
                  id:
                    activeProject !== 'all'
                      ? activeProject
                      : example.enabled
                        ? (exampleState().projectId ?? undefined)
                        : undefined,
                })
              }
            >
              Projects
            </button>
          )}
          <button aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            {isMobile ? <Icon name="settings" size={20} /> : 'Settings'}
          </button>
        </div>
      </header>

      <main className="app-layout">
        <aside
          id="clip-sheet"
          ref={sheetRef}
          className={`side-panel${sheetOn ? ' is-sheet' : ''}${sheetDragging ? ' is-dragging' : ''}`}
          role={sheetOn ? 'region' : undefined}
          aria-label={sheetOn ? 'Clips' : undefined}
          style={
            isMobile
              ? undefined
              : ({ '--panel-width': `${panelW}px` } as CSSProperties)
          }
        >
          {sheetOn && (
            <div className="sheet-grab" {...sheetHandleProps}>
              <button
                className="sheet-handle"
                aria-label="Clip panel"
                aria-expanded={snap !== 'collapsed'}
                aria-controls="clip-sheet"
                disabled={clips.length === 0}
                onClick={cycleSheet}
              >
                <span />
              </button>
              {collapsed && (
                <div
                  className="sheet-peek-wrap"
                  onClick={(e) => {
                    if (!(e.target as Element).closest('[data-no-drag]'))
                      setSnap('half');
                  }}
                >
                  <SheetPeek
                    clip={peekClip}
                    place={peekClip && projects.clipPlace[peekClip.id]}
                    playing={!!peekClip && peekClip.id === playingClipId}
                    busy={busy}
                    progress={progress}
                    barRef={peekBar}
                    onTogglePlay={() => {
                      if (!peekClip) return;
                      setSelectedClipId(peekClip.id);
                      setPlayingClipId((p) =>
                        p === peekClip.id ? null : peekClip.id,
                      );
                    }}
                  />
                </div>
              )}
            </div>
          )}
          <div className="sheet-body" ref={bodyRef}>
            {sheetOn && (
              <div className="sheet-title">
                <span role="status">
                  {visible.length} clip{visible.length === 1 ? '' : 's'} ·{' '}
                  {projectLabel}
                </span>
                <button
                  className="project-button is-primary"
                  onClick={() => addInput.current?.click()}
                >
                  <Icon name="upload" size={14} /> Add clips
                </button>
                <input
                  ref={addInput}
                  type="file"
                  multiple
                  hidden
                  accept=".mp4,.lrv,video/mp4,.json,application/json"
                  onChange={(e) => addPicked(e.target.files)}
                />
              </div>
            )}
            {sheetOn && busy && !collapsed && (
              <div className="sheet-busy" role="status">
                <strong>{progress ? progress.name : 'Working…'}</strong>
                <div className="progress-bar">
                  <i
                    className={progress?.frac == null ? 'is-indeterminate' : ''}
                    style={
                      progress?.frac == null
                        ? undefined
                        : { width: `${Math.round(progress.frac * 100)}%` }
                    }
                  />
                </div>
              </div>
            )}
            {isMobile && <div className="profile-host" ref={setProfileHost} />}
            {!sheetOn && (
              <div className="panel-title">
                Clips{' '}
                <span>
                  {clips.length > 0 && (
                    <button className="link-button" onClick={handleClear}>
                      <Icon name="trash" size={13} />
                      Clear all
                    </button>
                  )}
                  {visible.length}
                </span>
              </div>
            )}
            {projectMode ? (
              <ProjectBar
                views={projects.views}
                activeId={activeProject}
                dragging={dragClipId !== null}
                onChange={setProjectFilter}
                onRename={projects.rename}
                onManage={(id) => setProjectsModal({ id })}
                onCreate={() => {
                  const id = projects.createProject();
                  setProjectFilter(id);
                  return id;
                }}
                onDelete={handleDeleteProject}
                onDropClip={(clipId, target) => {
                  projects.moveClip(clipId, target);
                  setDragClipId(null);
                }}
              >
                {panelBody}
              </ProjectBar>
            ) : (
              panelBody
            )}
            {error && (
              <p className="error-message" role="alert">
                Couldn’t load {error}
              </p>
            )}
            {!emptyProject && upload}
            {sheetOn && (
              <OtherClips
                clips={sorted}
                selectedId={selectedClipId}
                onSelect={(id) => select(id, true)}
              />
            )}
          </div>
        </aside>

        {!isMobile && (
          <div
            className={`panel-resizer${dragging ? ' is-dragging' : ''}`}
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
        )}

        <section className="map-frame">
          <TrackMap
            clips={mapClips}
            apiRef={mapApi}
            selectedId={selectedClipId}
            hoveredId={hoveredClipId}
            onSelect={selectFromMap}
            onHover={isMobile ? () => {} : setHoveredClipId}
            compact={isMobile}
            insetBottom={sheetOn ? sheetVisiblePx : 0}
            profileHost={isMobile ? profileHost : null}
            onBackgroundTap={onBackgroundTap}
            onImmersive={() => setImmersive(true)}
            onSearchFocus={onSearchFocus}
          />
          {immersive && (
            <button
              className="immersive-exit"
              onClick={() => setImmersive(false)}
            >
              Exit map view
            </button>
          )}
          {clips.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-content">
                <h2>No tracks yet</h2>
                <p>Drop a GoPro MP4 to map your adventure.</p>
              </div>
            </div>
          )}
        </section>
      </main>

      {projectMode && projects.notice && (
        <ProjectNotice
          items={projects.notice}
          views={projects.views}
          clips={clips}
          activeId={activeProject}
          onOpen={setProjectFilter}
          onDismiss={projects.dismissNotice}
        />
      )}

      {projectMode && projectsDialog && (
        <ProjectsModal
          views={projects.views}
          clips={clips}
          initialId={projectsDialog.id}
          onRename={projects.rename}
          onMove={projects.moveClip}
          onCreate={projects.createProject}
          onDelete={handleDeleteProject}
          onUpload={(files, id) => void handleFiles(files, id)}
          busy={busy}
          progress={progress}
          onOpen={(id) => {
            setProjectFilter(id);
            setProjectsModal(null);
          }}
          onClose={() => setProjectsModal(null)}
        />
      )}

      {picker && (
        <ProjectPicker
          views={projects.views}
          mode={picker.kind}
          activeId={
            picker.kind === 'move'
              ? projects.projectOf.get(picker.clipId)
              : activeProject
          }
          onPick={(id) => {
            if (picker.kind === 'move') projects.moveClip(picker.clipId, id);
            else setProjectFilter(id);
            setPicker(null);
          }}
          onNew={() => {
            if (picker.kind === 'move') projects.moveClip(picker.clipId, 'new');
            else setProjectFilter(projects.createProject());
            setPicker(null);
          }}
          onManage={
            picker.kind === 'switch'
              ? () => {
                  setPicker(null);
                  setProjectsModal({
                    id: activeProject !== 'all' ? activeProject : undefined,
                  });
                }
              : undefined
          }
          onClose={() => setPicker(null)}
        />
      )}

      <ExampleStatus
        status={example.status}
        onRetry={() => example.setEnabled(true)}
        onDismiss={example.dismiss}
      />

      {settingsOpen && (
        <Settings
          clipCount={clips.length}
          exampleOn={example.enabled}
          exampleBusy={example.busy}
          onExampleChange={example.setEnabled}
          hideLayout={isMobile}
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

      {examplePrompt}

      {playbackHelp && <PlaybackHelp onClose={() => setPlaybackHelp(false)} />}

      {maxClip &&
        (videoWin ? (
          <VideoWindow
            key={maxClip.id}
            clip={maxClip}
            win={videoWin}
            onClose={closeMax}
            onPlayingChange={setMaxPlaying}
            onProgress={(f) => onFrac(maxClip.id, f)}
          />
        ) : (
          <VideoModal
            clip={maxClip}
            layout={isMobile ? 'mobile' : 'desktop'}
            onClose={closeMax}
            onPlayingChange={setMaxPlaying}
            onProgress={(f) => onFrac(maxClip.id, f)}
          />
        ))}
    </div>
  );
}
