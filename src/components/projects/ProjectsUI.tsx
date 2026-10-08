import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Clip, UploadProgress } from '../../types';
import SvgIcon, { type IconName } from '../common/SvgIcon';
import UploadZone from '../clips/UploadZone';
import {
  CLIP_MIME,
  fmtKm,
  GAP_DAYS,
  MAX_KM,
  type Placement,
  type ProjectView,
} from '../../lib/projects';
import './ProjectsUI.css';

const TOAST_MS = 5000;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** clips / days / distance as small icon chips (same look as the GPS-quality chip on a clip card) */
function StatChips({ v }: { v: ProjectView }) {
  const chips: [IconName, string][] = [
    ['camera', plural(v.clipIds.length, 'clip')],
  ];
  if (v.days) chips.push(['calendar', plural(v.days, 'day')]);
  if (v.distanceM) chips.push(['route', fmtKm(v.distanceM)]);
  return (
    <p className="ctt-pchips">
      {chips.map(([icon, text]) => (
        <span key={icon} className="ctt-pchip">
          <SvgIcon name={icon} size={12} />
          {text}
        </span>
      ))}
    </p>
  );
}

/** Generated names already carry the place ("Fabulous Times in Valencia"), so only custom names repeat it. */
const where = (v: ProjectView) =>
  (v.custom ? [v.place, v.range] : [v.range]).filter(Boolean).join(' · ');
const RULE = `Grouped automatically: clips within ${GAP_DAYS} days and ${MAX_KM} km of each other share a project.`;

// ───────── inline rename: Enter / ✓ / clicking away saves, Esc / ✕ cancels ─────────
// No random-name button here: a new project gets one generated name, "Reset name" brings it back.
function RenameField({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const settled = useRef(false); // save / cancel run once, whichever fires first
  const finish = (fn: () => void) => {
    if (settled.current) return;
    settled.current = true;
    fn();
  };
  // unchanged text is a cancel, so the generated name isn't frozen into a custom one by accident
  const save = () =>
    finish(() => (draft.trim() === value ? onCancel() : onSave(draft)));
  const keepFocus = (e: React.MouseEvent) => e.preventDefault(); // buttons must not blur the input first
  return (
    <div
      className="ctt-rn"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save();
      }}
    >
      <input
        autoFocus
        value={draft}
        maxLength={60}
        aria-label="Project name"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          else if (e.key === 'Escape') {
            e.stopPropagation(); // closes the editor, not the dialog
            finish(onCancel);
          }
        }}
      />
      <button
        className="ctt-btn ctt-rn-ok"
        title="Save"
        aria-label="Save name"
        onMouseDown={keepFocus}
        onClick={save}
      >
        <SvgIcon name="check" size={13} />
      </button>
      <button
        className="ctt-btn"
        title="Cancel"
        aria-label="Cancel rename"
        onMouseDown={keepFocus}
        onClick={() => finish(onCancel)}
      >
        <SvgIcon name="close" size={12} />
      </button>
    </div>
  );
}

/** Same confirm pattern as deleting a clip card. Deleting a project also deletes the clips inside it. */
function DeleteConfirm({
  v,
  onDelete,
  onCancel,
}: {
  v: ProjectView;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const n = v.clipIds.length;
  return (
    <div
      className="ctt-confirm"
      role="alertdialog"
      aria-label={`Delete ${v.name}?`}
    >
      <span>
        {n
          ? `Delete this project and its ${plural(n, 'clip')} from the map and saved data?`
          : 'Delete this project?'}
      </span>
      <button className="ctt-confirm-yes" autoFocus onClick={onDelete}>
        Delete
      </button>
      <button className="ctt-confirm-no" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

const clipIdFrom = (e: React.DragEvent) => e.dataTransfer.getData(CLIP_MIME);
const isClipDrag = (e: React.DragEvent) =>
  e.dataTransfer.types.includes(CLIP_MIME);

function DropChip({
  label,
  current,
  onDropClip,
}: {
  label: string;
  current?: boolean;
  onDropClip: (clipId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`ctt-chip-drop${over ? ' is-over' : ''}${current ? ' is-current' : ''}`}
      onDragOver={(e) => {
        if (!isClipDrag(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = clipIdFrom(e);
        if (id) onDropClip(id);
      }}
    >
      {label}
    </div>
  );
}

// ───────── styled project picker (replaces the native <select>) ─────────
function ProjectSelect({
  views,
  activeId,
  onChange,
}: {
  views: ProjectView[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const items: { id: string; label: string; n: number }[] = [
    { id: 'all', label: 'All projects', n: views.length },
    ...views.map((v) => ({ id: v.id, label: v.name, n: v.clipIds.length })),
  ];
  const cur = Math.max(
    0,
    items.findIndex((i) => i.id === activeId),
  );

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) =>
      !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [open]);

  const show = () => {
    setHi(cur);
    setOpen(true);
  };
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="ctt-psel" ref={root}>
      <button
        type="button"
        className={`ctt-psel-btn${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Project"
        aria-activedescendant={open ? `ctt-psel-${hi}` : undefined}
        disabled={!views.length}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (open) {
              e.stopPropagation();
              setOpen(false);
            }
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return show();
            const d = e.key === 'ArrowDown' ? 1 : -1;
            setHi((h) => (h + d + items.length) % items.length);
          } else if ((e.key === 'Enter' || e.key === ' ') && open) {
            e.preventDefault();
            pick(items[hi].id);
          }
        }}
      >
        <span className="ctt-psel-label">{items[cur].label}</span>
        <em>{items[cur].n}</em>
        <SvgIcon name="chevron" size={13} className="ctt-psel-chev" />
      </button>
      {open && (
        <ul className="ctt-psel-list" role="listbox" aria-label="Projects">
          {items.map((it, i) => (
            <li
              key={it.id}
              id={`ctt-psel-${i}`}
              role="option"
              aria-selected={it.id === activeId}
              className={`${it.id === activeId ? 'is-on' : ''}${i === hi ? ' is-hi' : ''}${it.id === 'all' ? ' is-all' : ''}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(it.id)}
            >
              <SvgIcon
                name={it.id === 'all' ? 'layers' : 'folder'}
                size={14}
                className="ctt-psel-ico"
              />
              <span>{it.label}</span>
              <em>{it.n}</em>
              {it.id === activeId && <SvgIcon name="check" size={13} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────── sidebar: current project header (lives inside the project container) ─────────
function ProjectHead({
  v,
  startEditing,
  onRename,
  onShowAll,
  onManage,
  onDelete,
}: {
  v: ProjectView;
  startEditing: boolean;
  onRename: (name: string) => void;
  onShowAll: () => void;
  onManage: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [asking, setAsking] = useState(false);
  return (
    <div className="ctt-phead">
      {editing ? (
        <RenameField
          value={v.name}
          onSave={(n) => {
            onRename(n);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="ctt-phead-title">
          <span className="ctt-phead-ico">
            <SvgIcon name="folder" size={15} />
          </span>
          <h2 title={v.name}>{v.name}</h2>
          <button
            className="ctt-btn"
            aria-label="Rename project"
            title="Rename"
            onClick={() => setEditing(true)}
          >
            <SvgIcon name="edit" size={13} />
          </button>
          <button
            className="ctt-btn"
            aria-label="Delete project"
            title="Delete project"
            aria-expanded={asking}
            onClick={() => setAsking((a) => !a)}
          >
            <SvgIcon name="trash" size={13} />
          </button>
        </div>
      )}
      <div className="ctt-phead-sub-container">
        <div className="ctt-phead-sub-header">
          <SvgIcon name="calendar" size={13} />
          <p className="ctt-phead-sub">{where(v)}</p>
        </div>
        <StatChips v={v} />
      </div>
      {asking && (
        <DeleteConfirm
          v={v}
          onDelete={onDelete}
          onCancel={() => setAsking(false)}
        />
      )}
      <div className="ctt-phead-act">
        <button className="ctt-link" onClick={onShowAll}>
          ← All projects
        </button>
        <button className="ctt-link" onClick={onManage}>
          Manage project
        </button>
        {v.custom && (
          <button
            className="ctt-link"
            title="Back to the generated name"
            onClick={() => onRename('')}
          >
            Reset name
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Sidebar block above the clip list.
 *  - a project switcher with a "New" button
 *  - a project open: ONE container holding its header (name, dates, stats) and the `children`
 *    (sort bar + clip cards), so the clips visibly belong to the project
 *  - while a clip card is being dragged: drop targets for every project
 * `children` always render at the same spot in the tree, so a drag in progress is never interrupted.
 */
export function ProjectBar({
  views,
  activeId,
  dragging,
  onChange,
  onRename,
  onManage,
  onCreate,
  onDelete,
  onDropClip,
  children,
}: {
  views: ProjectView[];
  activeId: string;
  dragging: boolean;
  onChange: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onManage: (id: string) => void;
  /** creates an empty project and returns its id */
  onCreate: () => string;
  onDelete: (id: string) => void;
  onDropClip: (clipId: string, target: string) => void;
  children?: ReactNode;
}) {
  const [fresh, setFresh] = useState<string | null>(null); // just created: open its name editor
  const active = views.find((v) => v.id === activeId);

  const top = dragging ? (
    <div className="ctt-ptray" aria-label="Drop the clip on a project">
      <small>Drop on a project</small>
      <div className="ctt-ptray-chips">
        {views.map((v) => (
          <DropChip
            key={v.id}
            label={v.name}
            current={v.id === activeId}
            onDropClip={(id) => onDropClip(id, v.id)}
          />
        ))}
        <DropChip
          label="＋ New project"
          onDropClip={(id) => onDropClip(id, 'new')}
        />
      </div>
    </div>
  ) : (
    <div className="ctt-pbar-row">
      <span className="ctt-sort-label">Project</span>
      <ProjectSelect views={views} activeId={activeId} onChange={onChange} />
      <button
        className="ctt-pbar-new"
        title="Create a new project"
        onClick={() => setFresh(onCreate())}
      >
        <SvgIcon name="plus" size={13} />
        New
      </button>
    </div>
  );

  return (
    <div className="ctt-pbar">
      {top}
      <div className={`ctt-pgroup${active ? '' : ' is-plain'}`}>
        {active && !dragging ? (
          <ProjectHead
            key={active.id}
            v={active}
            startEditing={fresh === active.id}
            onRename={(n) => onRename(active.id, n)}
            onShowAll={() => onChange('all')}
            onManage={() => onManage(active.id)}
            onDelete={() => onDelete(active.id)}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Toast shown for a few seconds after an upload: where the clips went. Hovering pauses the timer. */
export function ProjectNotice({
  items,
  views,
  clips,
  activeId,
  onOpen,
  onDismiss,
}: {
  items: Placement[];
  views: ProjectView[];
  clips: Clip[];
  activeId: string;
  onOpen: (projectId: string) => void;
  onDismiss: () => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(t);
  }, [items, paused, onDismiss]);

  const groups = new Map<
    string,
    { view: ProjectView; clips: Clip[]; created: boolean }
  >();
  for (const it of items) {
    const clip = clips.find((c) => c.id === it.clipId);
    const view = views.find((v) => v.id === it.projectId);
    if (!clip || !view) continue;
    const g = groups.get(view.id) ?? { view, clips: [], created: false };
    g.clips.push(clip);
    g.created ||= it.created;
    groups.set(view.id, g);
  }
  const rows = [...groups.values()];
  if (!rows.length) return null;
  const only = rows.length === 1 ? rows[0] : undefined;

  return (
    <div
      className="ctt-toast"
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="ctt-toast-ico">
        <SvgIcon name="folder" size={16} />
      </span>
      <div className="ctt-toast-body">
        <strong>{only ? 'Added to project' : 'Added to projects'}</strong>
        {rows.slice(0, 3).map(({ view, clips: cs, created }) => (
          <p key={view.id}>
            {cs.length === 1 ? cs[0].title : plural(cs.length, 'clip')} →{' '}
            <span className={`ctt-pill${created ? ' is-new' : ''}`}>
              {created ? 'New' : 'Existing'}
            </span>{' '}
            <b>{view.name}</b>
          </p>
        ))}
        {rows.length > 3 && <small>+{rows.length - 3} more projects</small>}
        {only && activeId !== only.view.id && (
          <button
            className="ctt-link"
            onClick={() => {
              onOpen(only.view.id);
              onDismiss();
            }}
          >
            Open project
          </button>
        )}
      </div>
      <button className="ctt-btn" aria-label="Dismiss" onClick={onDismiss}>
        <SvgIcon name="close" size={13} />
      </button>
    </div>
  );
}

// ───────── Projects dialog: list on the left, clips of the chosen project on the right ─────────
const byDate = (a: Clip, b: Clip) =>
  (a.sort.date ?? Infinity) - (b.sort.date ?? Infinity) || a.index - b.index;

function Thumb({ clip, size = 'md' }: { clip: Clip; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`ctt-pthumb is-${size}`}
      style={
        {
          '--c': clip.color,
          backgroundImage: clip.thumbnail
            ? `url(${clip.thumbnail})`
            : undefined,
        } as CSSProperties
      }
    >
      <i className="ctt-pnum">{clip.index}</i>
    </span>
  );
}

export function ProjectsDialog({
  views,
  clips,
  initialId,
  onRename,
  onMove,
  onOpen,
  onCreate,
  onDelete,
  onUpload,
  busy,
  progress,
  onClose,
}: {
  views: ProjectView[];
  clips: Clip[];
  initialId?: string;
  onRename: (id: string, name: string) => void;
  onMove: (clipId: string, target: string) => void;
  onOpen: (id: string) => void;
  /** creates an empty project and returns its id */
  onCreate: () => string;
  onDelete: (id: string) => void;
  /** add files from this computer straight into a project */
  onUpload: (files: File[], projectId: string) => void;
  busy?: boolean;
  progress?: UploadProgress | null;
  onClose: () => void;
}) {
  const [selId, setSelId] = useState(initialId ?? views[0]?.id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const byId = new Map(clips.map((c) => [c.id, c]));
  const clipsOf = (v: ProjectView) =>
    v.clipIds
      .map((id) => byId.get(id))
      .filter((c): c is Clip => !!c)
      .sort(byDate);
  const sel = views.find((v) => v.id === selId) ?? views[0];
  const selClips = sel ? clipsOf(sel) : [];
  const others = sel
    ? views
        .filter((v) => v.id !== sel.id)
        .flatMap((v) => clipsOf(v).map((c) => ({ c, from: v.name })))
    : [];
  const choose = (id: string) => {
    setSelId(id);
    setEditing(false);
    setAdding(false);
    setAsking(false);
  };
  const create = () => {
    choose(onCreate());
    setEditing(true); // name it right away
  };
  const dragProps = (c: Clip) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(CLIP_MIME, c.id);
      e.dataTransfer.effectAllowed = 'move';
      setDragId(c.id);
    },
    onDragEnd: () => {
      setDragId(null);
      setOverId(null);
    },
  });
  const drop = (target: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const id = clipIdFrom(e);
    if (id) onMove(id, target);
    setDragId(null);
    setOverId(null);
  };
  const dropOver = (key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isClipDrag(e)) return;
      e.preventDefault();
      setOverId(key);
    },
    onDragLeave: () => setOverId(null),
  });

  return (
    <div
      className="ctt-set-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="ctt-pd"
        role="dialog"
        aria-modal="true"
        aria-label="Projects"
      >
        <div className="ctt-pd-head">
          <h2>Projects</h2>
          <span
            className="ctt-pd-info"
            title={RULE}
            aria-label={RULE}
            tabIndex={0}
          >
            <SvgIcon name="info" size={14} />
          </span>
          <span className="ctt-pd-sub">Auto-grouped by date &amp; place</span>
          <button className="ctt-pbtn is-primary" onClick={create}>
            <SvgIcon name="plus" size={13} /> New project
          </button>
          <button
            className="ctt-btn"
            aria-label="Close projects"
            onClick={onClose}
          >
            <SvgIcon name="close" size={14} />
          </button>
        </div>

        {!sel ? (
          <p className="ctt-pd-empty">
            No projects yet. Create one, or upload a clip to start one
            automatically.
          </p>
        ) : (
          <div className="ctt-pd-body">
            <ul className="ctt-plist" aria-label="Projects">
              {views.map((v) => {
                const cs = clipsOf(v);
                return (
                  <li
                    key={v.id}
                    className={`ctt-pitem${v.id === sel.id ? ' is-on' : ''}${overId === v.id ? ' is-over' : ''}`}
                    onClick={() => choose(v.id)}
                    {...dropOver(v.id)}
                    onDrop={drop(v.id)}
                  >
                    <span className="ctt-pstack">
                      {cs.length ? (
                        cs
                          .slice(0, 3)
                          .map((c) => <Thumb key={c.id} clip={c} size="sm" />)
                      ) : (
                        <span className="ctt-pthumb is-sm is-empty">
                          <SvgIcon name="folder" size={13} />
                        </span>
                      )}
                    </span>
                    <span className="ctt-pitem-tx">
                      <b>{v.name}</b>
                      <small>{v.range}</small>
                    </span>
                    <em>{v.clipIds.length}</em>
                  </li>
                );
              })}
              {dragId && (
                <li
                  className={`ctt-pnew${overId === 'new' ? ' is-over' : ''}`}
                  {...dropOver('new')}
                  onDrop={drop('new')}
                >
                  <SvgIcon name="plus" size={14} /> New project
                </li>
              )}
            </ul>

            <section className="ctt-pdetail" aria-label={sel.name}>
              <header>
                {editing ? (
                  <RenameField
                    value={sel.name}
                    onSave={(n) => {
                      onRename(sel.id, n);
                      setEditing(false);
                    }}
                    onCancel={() => setEditing(false)}
                  />
                ) : (
                  <div className="ctt-phead-title">
                    <span className="ctt-phead-ico">
                      <SvgIcon name="folder" size={15} />
                    </span>
                    <h3 title={sel.name}>{sel.name}</h3>
                    <button
                      className="ctt-btn"
                      aria-label="Rename project"
                      title="Rename"
                      onClick={() => setEditing(true)}
                    >
                      <SvgIcon name="edit" size={13} />
                    </button>
                    <button
                      className="ctt-btn"
                      aria-label="Delete project"
                      title="Delete project"
                      aria-expanded={asking}
                      onClick={() => setAsking((a) => !a)}
                    >
                      <SvgIcon name="trash" size={13} />
                    </button>
                    {sel.custom && (
                      <button
                        className="ctt-link"
                        title="Back to the generated name"
                        onClick={() => onRename(sel.id, '')}
                      >
                        Reset name
                      </button>
                    )}
                  </div>
                )}

                <div className="ctt-phead-sub-container">
                  <div className="ctt-phead-sub-header">
                    <SvgIcon name="calendar" size={13} />
                    <p className="ctt-phead-sub">{where(sel)}</p>
                  </div>
                  <StatChips v={sel} />
                </div>
                {asking && (
                  <DeleteConfirm
                    v={sel}
                    onDelete={() => {
                      setAsking(false);
                      onDelete(sel.id);
                    }}
                    onCancel={() => setAsking(false)}
                  />
                )}
                <div className="ctt-pd-act">
                  <button
                    className="ctt-pbtn is-primary"
                    disabled={!sel.clipIds.length}
                    onClick={() => onOpen(sel.id)}
                  >
                    Open on map
                  </button>
                  <button
                    className="ctt-pbtn"
                    aria-pressed={adding}
                    disabled={!others.length}
                    title={others.length ? undefined : 'No other clips to add'}
                    onClick={() => setAdding((a) => !a)}
                  >
                    <SvgIcon name="plus" size={13} /> Add clips
                  </button>
                </div>
              </header>

              {adding && (
                <div className="ctt-padd">
                  <small>From other projects</small>
                  <ul>
                    {others.map(({ c, from }) => (
                      <li key={c.id}>
                        <Thumb clip={c} size="sm" />
                        <span className="ctt-pitem-tx">
                          <b>{c.title}</b>
                          <small>{from}</small>
                        </span>
                        <button
                          className="ctt-pbtn"
                          onClick={() => onMove(c.id, sel.id)}
                        >
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="ctt-pupload">
                <UploadZone
                  onFiles={(files) => onUpload(files, sel.id)}
                  busy={busy}
                  progress={progress}
                />
              </div>

              {selClips.length ? (
                <>
                  <p className="ctt-pd-legend">
                    Border colour = route on the map · drag a clip onto a
                    project to move it
                  </p>
                  <ul className="ctt-pclips">
                    {selClips.map((c) => (
                      <li
                        key={c.id}
                        className={dragId === c.id ? 'is-drag' : ''}
                        style={{ '--c': c.color } as CSSProperties}
                        {...dragProps(c)}
                      >
                        <Thumb clip={c} />
                        <span className="ctt-pitem-tx">
                          <b>{c.title}</b>
                          <small>
                            {c.date} · {c.distance}
                          </small>
                        </span>
                        <button
                          className="ctt-btn"
                          aria-label={`Remove ${c.title} from this project`}
                          title="Remove from project (moves to its own project)"
                          disabled={selClips.length < 2}
                          onClick={() => onMove(c.id, 'new')}
                        >
                          <SvgIcon name="close" size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="ctt-pd-none">
                  This project is empty. Upload clips above, or use “Add clips”
                  to bring some in from other projects.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
