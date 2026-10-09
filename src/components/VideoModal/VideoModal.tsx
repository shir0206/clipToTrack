import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Clip } from '../../types';
import Icon from '../Icon/Icon';
import { clipColorVars } from '../../lib/clipColorStyle';

type Props = {
  clip: Clip;
  onClose: () => void;
  onProgress?: (frac: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** 'mobile': full-bleed player with touch controls, telemetry HUD and a mini route */
  layout?: 'desktop' | 'mobile';
};

const toggle = (v: HTMLVideoElement) => {
  if (v.paused) v.play().catch(() => {});
  else v.pause();
};

const clock = (s: number) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};
type LockableOrientation = ScreenOrientation & {
  lock?: (o: string) => Promise<void>;
};

/** Mini route: the clip's coordinates as an SVG polyline + the current position (no second map). */
function MiniRoute({ clip, frac }: { clip: Clip; frac: number }) {
  const shape = useMemo(() => {
    const pts = clip.coordinates;
    if (pts.length < 2) return null;
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const [x0, x1] = [Math.min(...lons), Math.max(...lons)];
    const [y0, y1] = [Math.min(...lats), Math.max(...lats)];
    // equirectangular: shrink longitude by cos(lat) so the route keeps its shape
    const k = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
    const w = Math.max((x1 - x0) * k, 1e-9);
    const h = Math.max(y1 - y0, 1e-9);
    const s = 100 / Math.max(w, h);
    const ox = (100 - w * s) / 2;
    const oy = (100 - h * s) / 2;
    const xy = (p: [number, number]): [number, number] => [
      ox + (p[0] - x0) * k * s,
      oy + (y1 - p[1]) * s,
    ];
    const step = Math.max(1, Math.floor(pts.length / 200)); // 200 points are plenty at this size
    const line = pts
      .filter((_, i) => i % step === 0 || i === pts.length - 1)
      .map((p) => xy(p).join(','))
      .join(' ');
    return { line, xy };
  }, [clip.coordinates]);
  if (!shape) return null;
  const n = clip.coordinates.length;
  // same mapping as the map's playhead / probe: sample index = round(frac * (n - 1))
  const i = Math.round(Math.min(Math.max(frac, 0), 1) * (n - 1));
  const [cx, cy] = shape.xy(clip.coordinates[i]);
  return (
    <svg
      className="mini-route"
      viewBox="-6 -6 112 112"
      role="img"
      aria-label="Route and current position"
    >
      <polyline points={shape.line} />
      <circle cx={cx} cy={cy} r="5" />
    </svg>
  );
}

/** Large player for one clip. Esc / backdrop click / ✕ closes it. */
export default function VideoModal({
  clip,
  onClose,
  onProgress,
  onPlayingChange,
  layout = 'desktop',
}: Props) {
  const mobile = layout === 'mobile';
  const box = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const [t, setT] = useState({ cur: 0, dur: 0 });
  const [playing, setPlaying] = useState(true);
  const [chrome, setChrome] = useState(true); // control bar visible
  const hideTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef({ t: 0, x: 0 });
  const [ripple, setRipple] = useState<'back' | 'fwd' | null>(null);

  const seekBy = (d: number) => {
    const v = videoRef.current;
    if (!v) return;
    const to = v.currentTime + d;
    v.currentTime = Math.max(0, Math.min(to, v.duration || to));
  };

  const poke = () => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 3000);
  };
  useEffect(() => {
    if (!mobile) return;
    const id = window.setTimeout(poke, 0);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(hideTimer.current);
    };
  }, [mobile]);

  useEffect(() => {
    // no native toolbar: click / Space = play-pause, ← → = seek 5 s, Esc = close
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (e.key === 'Escape') onClose();
      else if (!v) return;
      else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        toggle(v);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(e.key === 'ArrowRight' ? 5 : -5);
      }
    };
    window.addEventListener('keydown', onKey);
    box.current?.focus(); // not the ✕ button, so Space doesn't "press" it
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Android back button closes the player instead of leaving the app
  useEffect(() => {
    if (!mobile) return;
    let popped = false;
    history.pushState({ ctt: 'player' }, '');
    const pop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('popstate', pop);
      if (!popped && history.state?.ctt === 'player') history.back();
    };
  }, [mobile]);

  const fullscreen = async () => {
    const v = videoRef.current as FullscreenVideo | null;
    try {
      if (v?.webkitEnterFullscreen)
        v.webkitEnterFullscreen(); // iOS: only <video> can go fullscreen
      else {
        await box.current?.requestFullscreen?.();
        await (screen.orientation as LockableOrientation).lock?.('landscape');
      }
    } catch {
      /* not allowed here (needs a gesture / not supported): portrait stays fully usable */
    }
  };

  // tap = show / hide controls, double tap on the left / right third = -5 s / +5 s
  const onSurface = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const now = performance.now();
    if (now - lastTap.current.t < 300 && (x < 0.33 || x > 0.67)) {
      const back = x < 0.33;
      seekBy(back ? -5 : 5);
      setRipple(back ? 'back' : 'fwd');
      setTimeout(() => setRipple(null), 450);
      lastTap.current.t = 0;
      poke();
      return;
    }
    lastTap.current = { t: now, x };
    if (chrome) setChrome(false);
    else poke();
  };

  const frac = t.dur ? t.cur / t.dur : 0;
  const n = clip.coordinates.length;
  const idx = Math.round(Math.min(Math.max(frac, 0), 1) * Math.max(0, n - 1));
  const sample = clip.samples[idx];
  const speed = sample?.speed3dKmh;
  const alt = sample?.altM;

  const video = (
    <video
      ref={videoRef}
      className="modal-video"
      src={clip.videoUrl}
      poster={clip.thumbnail}
      autoPlay
      playsInline
      onClick={mobile ? undefined : (e) => toggle(e.currentTarget)}
      onPlay={() => {
        setPlaying(true);
        onPlayingChange?.(true);
      }}
      onPause={() => {
        setPlaying(false);
        onPlayingChange?.(false);
      }}
      onEnded={() => onPlayingChange?.(false)}
      onLoadedMetadata={(e) =>
        setT((s) => ({ ...s, dur: e.currentTarget.duration || 0 }))
      }
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (mobile) setT({ cur: v.currentTime, dur: v.duration || 0 });
        if (v.duration) onProgress?.(v.currentTime / v.duration);
      }}
    />
  );

  if (!mobile)
    return (
      <div
        className="video-modal"
        role="dialog"
        aria-modal="true"
        aria-label={clip.title}
        onClick={onClose}
      >
        <div
          ref={box}
          tabIndex={-1}
          className="modal-box"
          style={clipColorVars(clip.color) as CSSProperties}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <span className="track-badge">{clip.index}</span>
            <strong>{clip.title}</strong>
            <small>
              {clip.date} · {clip.camera}
            </small>
            <button
              className="icon-button"
              aria-label="Close video"
              onClick={onClose}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          {video}
        </div>
      </div>
    );

  return (
    <div
      className="video-modal is-mobile"
      role="dialog"
      aria-modal="true"
      aria-label={clip.title}
    >
      <div
        ref={box}
        tabIndex={-1}
        className={`modal-box${chrome ? ' is-chrome' : ''}`}
        style={clipColorVars(clip.color) as CSSProperties}
      >
        <div className="modal-header">
          <span className="track-badge">{clip.index}</span>
          <strong>{clip.title}</strong>
          <small>
            {clip.date} · {clip.camera}
          </small>
          <button
            className="icon-button"
            aria-label="Close video"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="player-stage">
          {video}
          {/* tap surface: video elements swallow taps, so a layer on top handles them */}
          <div
            className="player-surface"
            onPointerUp={onSurface}
            aria-hidden="true"
          />
          {ripple && <span className={`player-ripple is-${ripple}`}>5 s</span>}

          <div className="player-hud" aria-label="Telemetry at this moment">
            {speed !== undefined && (
              <span>
                <b>{Math.round(speed)}</b> km/h
              </span>
            )}
            {alt !== undefined && (
              <span>
                <b>{Math.round(alt)}</b> m
              </span>
            )}
          </div>
          <MiniRoute clip={clip} frac={frac} />

          <div className="player-controls" aria-hidden={!chrome}>
            <button
              className="icon-button is-primary"
              aria-label={playing ? 'Pause' : 'Play'}
              tabIndex={chrome ? 0 : -1}
              onClick={() => {
                const v = videoRef.current;
                if (v) toggle(v);
                poke();
              }}
            >
              <Icon name={playing ? 'pause' : 'play'} size={16} />
            </button>
            <span className="player-time">{clock(t.cur)}</span>
            <input
              type="range"
              className="player-scrub"
              aria-label="Seek"
              min={0}
              max={t.dur || 1}
              step={0.1}
              value={Math.min(t.cur, t.dur || 1)}
              tabIndex={chrome ? 0 : -1}
              onChange={(e) => {
                const v = videoRef.current;
                if (v) v.currentTime = Number(e.target.value);
                setT((s) => ({ ...s, cur: Number(e.target.value) }));
                poke();
              }}
            />
            <span className="player-time">{clock(t.dur)}</span>
            <button
              className="icon-button"
              aria-label="Fullscreen"
              tabIndex={chrome ? 0 : -1}
              onClick={() => void fullscreen()}
            >
              <Icon name="maximize" size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
