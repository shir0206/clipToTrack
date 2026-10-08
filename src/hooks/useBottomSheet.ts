import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
} from 'react';

export type Snap = 'collapsed' | 'half' | 'expanded';
const ORDER: Snap[] = ['collapsed', 'half', 'expanded'];
const KEY = 'clip-to-track:sheet-snap';
const PEEK_PX = 72;
const FLING = 0.5; // px/ms

const loadSnap = (): Snap => {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'collapsed' || s === 'half' || s === 'expanded') return s;
  } catch {
    /* ignore */
  }
  return 'half';
};

type Opts = {
  enabled: boolean;
  /** forces a snap (e.g. 'half' while there are no clips) */
  lock?: Snap;
};

/**
 * Snap-point state machine for the bottom sheet. Dragging writes `--sheet-y` straight to the
 * element (no React state per frame). `visiblePx` follows the snap synchronously, so the map
 * can pad its camera in the same render in which the sheet changes.
 */
export function useBottomSheet({ enabled, lock }: Opts) {
  const ref = useRef<HTMLElement>(null);
  const [stored, setStored] = useState<Snap>(loadSnap);
  const [dragging, setDragging] = useState(false);
  const [geo, setGeo] = useState({ full: 0, safe: 0 });
  const [vh, setVh] = useState(() => window.innerHeight);
  const snap = lock ?? stored;
  const drag = useRef<{
    startY: number;
    startVis: number;
    lastY: number;
    lastT: number;
    v: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const setSnap = useCallback((s: Snap) => {
    setStored(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* ignore */
    }
  }, []);

  // how many px of the sheet are on screen at each snap
  const heights = useCallback((): Record<Snap, number> => {
    const full = geo.full || Math.max(240, vh - 60);
    return {
      collapsed: Math.min(PEEK_PX + geo.safe, full),
      half: Math.min(Math.round(vh * 0.52), full),
      expanded: full,
    };
  }, [geo, vh]);
  const visiblePx = enabled ? heights()[snap] : 0;

  // measure the real sheet (its CSS height and safe-area padding)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => {
      const full = el.offsetHeight;
      const safe = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      setVh(window.innerHeight);
      setGeo((g) => (g.full === full && g.safe === safe ? g : { full, safe }));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [enabled]);

  const apply = useCallback((visible: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty(
      '--sheet-y',
      `${Math.max(0, el.offsetHeight - visible)}px`,
    );
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!enabled) {
      el.style.removeProperty('--sheet-y');
      return;
    }
    apply(visiblePx);
  }, [enabled, visiblePx, apply]);

  useEffect(() => {
    if (!enabled) setDragging(false);
  }, [enabled]);

  const cycle = useCallback(() => {
    if (lock) return;
    setSnap(ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]);
  }, [lock, snap, setSnap]);

  const handleProps = {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (!enabled || lock) return;
      if ((e.target as Element).closest('[data-no-drag]')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        startY: e.clientY,
        startVis: visiblePx,
        lastY: e.clientY,
        lastT: performance.now(),
        v: 0,
        moved: false,
      };
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dy) > 6) {
        d.moved = true;
        setDragging(true);
      }
      if (!d.moved) return;
      const h = heights();
      const now = performance.now();
      d.v = (e.clientY - d.lastY) / Math.max(1, now - d.lastT);
      d.lastY = e.clientY;
      d.lastT = now;
      let vis = d.startVis - dy;
      if (vis < h.collapsed) vis = h.collapsed - (h.collapsed - vis) * 0.3; // rubber band
      if (vis > h.expanded) vis = h.expanded + (vis - h.expanded) * 0.2;
      requestAnimationFrame(() => apply(vis));
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d || !d.moved) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      setDragging(false);
      const h = heights();
      const vis = d.startVis - (e.clientY - d.startY);
      let target: Snap;
      if (Math.abs(d.v) >= FLING) {
        const i = ORDER.indexOf(snap) + (d.v < 0 ? 1 : -1); // dragging up = negative velocity
        target = ORDER[Math.min(2, Math.max(0, i))];
      } else {
        target = ORDER.reduce((best, s) =>
          Math.abs(h[s] - vis) < Math.abs(h[best] - vis) ? s : best,
        );
      }
      setSnap(target);
      apply(h[target]); // settle even if the snap did not change
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragging(false);
      apply(visiblePx);
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (suppressClick.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };

  return { ref, snap, setSnap, cycle, visiblePx, dragging, handleProps };
}
