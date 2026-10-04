import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Clip } from './types';
import SvgIcon from './SvgIcon';
import {
  CLIP_MIME,
  fmtKm,
  GAP_DAYS,
  MAX_KM,
  suggestName,
  type Placement,
  type ProjectView,
} from './projects';
import './ProjectsUI.css';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const stats = (v: ProjectView) =>
  [
    plural(v.clipIds.length, 'clip'),
    v.days ? plural(v.days, 'day') : undefined,
    v.distanceM ? fmtKm(v.distanceM) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
/** The dates stay visible even when the project has a custom name. */
const where = (v: ProjectView) =>
  [v.place, v.range].filter(Boolean).join(' · ');
const RULE = `Grouped automatically: clips within ${GAP_DAYS} days and ${MAX_KM} km of each other share a project.`;

// ───────── inline rename: Enter / ✓ / clicking away saves, Esc / ✕ cancels, 🎲 suggests a name ─────────
function RenameField({
  value,
  taken,
  onSave,
  onCancel,
}: {
  value: string;
  taken: string[];
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
  const keepFocus = (e: React.MouseEvent) => e.preventDefault(); // buttons must not blur the input first
  return (
    <div
      className="ctt-rn"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          finish(() => onSave(draft));
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
          if (e.key === 'Enter') finish(() => onSave(draft));
          else if (e.key === 'Escape') {
            e.stopPropagation(); // closes the editor, not the dialog
            finish(onCancel);
          }
        }}
      />
      <button
        className="ctt-btn"
        title="Random name"
        aria-label="Suggest a random name"
        onMouseDown={keepFocus}
        onClick={() => setDraft(suggestName(taken))}
      >
        <SvgIcon name="shuffle" size={13} />
      </button>
      <button
        className="ctt-btn ctt-rn-ok"
        title="Save"
        aria-label="Save name"
        onMouseDown={keepFocus}
        onClick={() => finish(() => onSave(draft))}
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

// ───────── sidebar: current project header ─────────
function ProjectHead({
  v,
  taken,
  onRename,
  onShowAll,
  onManage,
}: {
  v: ProjectView;
  taken: string[];
  onRename: (name: string) => void;
  onShowAll: () => void;
  onManage: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="ctt-phead">
      {editing ? (
        <RenameField
          value={v.name}
          taken={taken}
          onSave={(n) => {
            onRename(n);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="ctt-phead-title">
          <SvgIcon name="folder" size={16} />
          <h2 title={v.name}>{v.name}</h2>
          <button
            className="ctt-btn"
            aria-label="Rename project"
            title="Rename"
            onClick={() => setEditing(true)}
          >
            <SvgIcon name="edit" size={13} />
          </button>
        </div>
      )}
      <p className="ctt-phead-sub">{where(v)}</p>
      <p className="ctt-phead-stats">{stats(v)}</p>
      <div className="ctt-phead-act">
        <button className="ctt-link" onClick={onShowAll}>
          ← All clips
        </button>
        <button className="ctt-link" onClick={onManage}>
          Manage clips
        </button>
      </div>
    </div>
  );
}

/**
 * Sidebar block above the clip list.
 *  - nothing open: a project switcher
 *  - a project open: its name (renamable), dates, place and stats
 *  - while a clip card is being dragged: drop targets for every project
 */
export function ProjectBar({
  views,
  total,
  activeId,
  dragging,
  onChange,
  onRename,
  onManage,
  onDropClip,
}: {
  views: ProjectView[];
  total: number;
  activeId: string;
  dragging: boolean;
  onChange: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onManage: (id: string) => void;
  onDropClip: (clipId: string, target: string) => void;
}) {
  if (!views.length) return null;
  const active = views.find((v) => v.id === activeId);

  if (dragging)
    return (
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
    );

  return (
    <div className="ctt-pbar">
      <label>
        <span className="ctt-sort-label">Project</span>
        <select value={activeId} onChange={(e) => onChange(e.target.value)}>
          <option value="all">All clips ({total})</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.clipIds.length})
            </option>
          ))}
        </select>
      </label>
      {active && (
        <ProjectHead
          key={active.id}
          v={active}
          taken={views.map((x) => x.name)}
          onRename={(n) => onRename(active.id, n)}
          onShowAll={() => onChange('all')}
          onManage={() => onManage(active.id)}
        />
      )}
    </div>
  );
}

/** Tells the user where a fresh upload was attached (existing / new project) and lets them change it. */
export function ProjectNotice({
  items,
  views,
  clips,
  activeId,
  onMove,
  onOpen,
  onDismiss,
}: {
  items: Placement[];
  views: ProjectView[];
  clips: Clip[];
  activeId: string;
  onMove: (clipId: string, target: string) => void;
  onOpen: (projectId: string) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 20_000);
    return () => clearTimeout(t);
  }, [items, onDismiss]);

  const rows = items.flatMap((it) => {
    const clip = clips.find((c) => c.id === it.clipId);
    const view = views.find((v) => v.id === it.projectId);
    return clip && view ? [{ it, clip, view }] : [];
  });
  if (!rows.length) return null;

  return (
    <div className="ctt-pnote" role="status">
      <div className="ctt-pnote-head">
        <SvgIcon name="route" size={14} />
        <strong>Added to {rows.length > 1 ? 'projects' : 'a project'}</strong>
        <button className="ctt-btn" aria-label="Dismiss" onClick={onDismiss}>
          <SvgIcon name="close" size={12} />
        </button>
      </div>
      {rows.slice(0, 3).map(({ it, clip, view }) => (
        <div key={it.clipId} className="ctt-pnote-row">
          <p>
            <b>{clip.title}</b> →{' '}
            <span className={`ctt-pill${it.created ? ' is-new' : ''}`}>
              {it.created ? 'New project' : 'Existing project'}
            </span>{' '}
            {view.name}
          </p>
          <div className="ctt-pnote-act">
            <select
              aria-label={`Project for ${clip.title}`}
              value={view.id}
              onChange={(e) => onMove(it.clipId, e.target.value)}
            >
              {views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
              <option value="new">＋ New project…</option>
            </select>
            {activeId !== 'all' && activeId !== view.id && (
              <button className="ctt-link" onClick={() => onOpen(view.id)}>
                Open project
              </button>
            )}
          </div>
        </div>
      ))}
      {rows.length > 3 && <small>+{rows.length - 3} more</small>}
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
  onClose,
}: {
  views: ProjectView[];
  clips: Clip[];
  initialId?: string;
  onRename: (id: string, name: string) => void;
  onMove: (clipId: string, target: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [selId, setSelId] = useState(initialId ?? views[0]?.id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
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
            No projects yet. Upload a clip to start one.
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
                    onClick={() => {
                      setSelId(v.id);
                      setEditing(false);
                      setAdding(false);
                    }}
                    {...dropOver(v.id)}
                    onDrop={drop(v.id)}
                  >
                    <span className="ctt-pstack">
                      {cs.slice(0, 3).map((c) => (
                        <Thumb key={c.id} clip={c} size="sm" />
                      ))}
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
                    taken={views.map((v) => v.name)}
                    onSave={(n) => {
                      onRename(sel.id, n);
                      setEditing(false);
                    }}
                    onCancel={() => setEditing(false)}
                  />
                ) : (
                  <div className="ctt-phead-title">
                    <h3>{sel.name}</h3>
                    <button
                      className="ctt-btn"
                      aria-label="Rename project"
                      title="Rename"
                      onClick={() => setEditing(true)}
                    >
                      <SvgIcon name="edit" size={13} />
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
                <p className="ctt-phead-sub">{where(sel)}</p>
                <p className="ctt-phead-stats">{stats(sel)}</p>
                <div className="ctt-pd-act">
                  <button
                    className="ctt-pbtn is-primary"
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

              <p className="ctt-pd-legend">
                Border colour = route on the map · drag a clip onto a project to
                move it
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
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
