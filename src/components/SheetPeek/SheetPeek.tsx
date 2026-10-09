import type { CSSProperties, RefObject } from 'react';
import type { Clip, UploadProgress } from '../../types';
import Icon from '../Icon/Icon';
import { clipColorVars } from '../../lib/clipColorStyle';

type PeekProps = {
  /** the clip that is playing, else the selected one */
  clip?: Clip;
  place?: string;
  playing: boolean;
  busy?: boolean;
  progress?: UploadProgress | null;
  /** written straight from the video's frame loop (scaleX 0..1): no React state per frame */
  barRef: RefObject<HTMLElement | null>;
  onTogglePlay: () => void;
};

const PHASE = {
  index: 'Reading file index…',
  telemetry: 'Reading telemetry',
  thumbnail: 'Creating thumbnail…',
};

/** Collapsed sheet: what is selected / playing, play-pause, progress; upload progress while importing. */
export function SheetPeek({
  clip,
  place,
  playing,
  busy,
  progress,
  barRef,
  onTogglePlay,
}: PeekProps) {
  const pct = progress?.frac == null ? null : Math.round(progress.frac * 100);
  if (busy)
    return (
      <div className="sheet-peek is-busy" role="status">
        <span className="peek-text">
          <strong>
            {progress ? PHASE[progress.phase] : 'Working…'}
            {pct !== null ? ` ${pct}%` : ''}
          </strong>
          <small>
            {progress
              ? `${progress.of > 1 ? `${progress.n}/${progress.of} · ` : ''}${progress.name}`
              : ''}
          </small>
        </span>
        <div className="peek-progress">
          <i
            className={pct === null ? 'is-indeterminate' : ''}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
      </div>
    );
  if (!clip)
    return (
      <div className="sheet-peek">
        <span className="peek-text">
          <strong>No clip selected</strong>
          <small>Swipe up to pick one</small>
        </span>
      </div>
    );
  return (
    <div
      className="sheet-peek"
      style={clipColorVars(clip.color) as CSSProperties}
    >
      <span className="track-badge" />
      <span className="peek-text">
        <strong>{clip.title}</strong>
        <small>{place || clip.date}</small>
      </span>
      <button
        className="icon-button is-primary"
        data-no-drag
        aria-label={`${playing ? 'Pause' : 'Play'} ${clip.title}`}
        disabled={!clip.videoUrl}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePlay();
        }}
      >
        <Icon name={playing ? 'pause' : 'play'} size={14} />
      </button>
      <span
        className="peek-thumb"
        style={
          clip.thumbnail
            ? ({ '--thumbnail': `url(${clip.thumbnail})` } as CSSProperties)
            : undefined
        }
        aria-hidden="true"
      />
      <div className="peek-progress" aria-hidden="true">
        <i ref={barRef as RefObject<HTMLElement & HTMLDivElement>} />
      </div>
    </div>
  );
}

/** Half sheet: horizontal strip of the other clips (navigation only; full details live on the card). */
export function OtherClips({
  clips,
  selectedId,
  onSelect,
}: {
  clips: Clip[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const others = clips.filter((c) => c.id !== selectedId);
  if (!others.length) return null;
  return (
    <section className="other-clips" aria-label="Other clips">
      <h3 className="menu-title">Other clips</h3>
      <ul>
        {others.map((c) => (
          <li key={c.id}>
            <button
              style={clipColorVars(c.color) as CSSProperties}
              onClick={() => onSelect(c.id)}
              aria-label={`Select ${c.title}`}
            >
              <span
                className="mini-thumb"
                style={
                  c.thumbnail
                    ? ({
                        '--thumbnail': `url(${c.thumbnail})`,
                      } as CSSProperties)
                    : undefined
                }
              />
              <strong>{c.title}</strong>
              <small>{c.duration}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
