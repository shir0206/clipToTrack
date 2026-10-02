import type { CSSProperties } from 'react';
import type { Clip } from './types';

type Props = {
  clip: Clip;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  onTogglePlay: () => void;
  onStop: () => void;
};

export default function ClipCard({
  clip,
  selected,
  playing,
  onSelect,
  onHover,
  onTogglePlay,
  onStop,
}: Props) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <li
      id={`ctt-${clip.id}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      aria-label={`Select track ${clip.index} ${clip.title}`}
      className={`ctt-card${selected ? ' is-selected' : ''}${playing ? ' is-playing' : ''}`}
      style={{ '--c': clip.color } as CSSProperties}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div
        className="ctt-thumb"
        style={
          clip.thumbnail
            ? { backgroundImage: `url(${clip.thumbnail})` }
            : undefined
        }
      >
        <span className="ctt-duration">{clip.duration}</span>
      </div>

      <div className="ctt-card-body">
        <div className="ctt-card-head">
          <span className="ctt-badge">{clip.index}</span>
          <div>
            <h3>{clip.title}</h3>
            <p>{clip.date}</p>
            <p>{clip.camera}</p>
          </div>
        </div>

        <div className="ctt-controls">
          <button
            className="ctt-btn ctt-btn-primary"
            aria-label={`${playing ? 'Pause' : 'Play'} ${clip.title}`}
            onClick={stop(onTogglePlay)}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            className="ctt-btn"
            aria-label={`Stop ${clip.title}`}
            onClick={stop(onStop)}
          >
            ■
          </button>
          {playing && <span className="ctt-playing">Playing</span>}
        </div>
      </div>

      <dl className="ctt-stats">
        <div>
          <dt>Duration</dt>
          <dd>{clip.duration}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>{clip.distance}</dd>
        </div>
        <div>
          <dt>Max speed</dt>
          <dd>{clip.maxSpeed}</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd>{clip.altitude}</dd>
        </div>
      </dl>
      <p className="ctt-quality">{clip.gpsQuality}</p>
    </li>
  );
}
