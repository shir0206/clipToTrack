import { useSyncExternalStore } from 'react';

export type LayoutMode = 'desktop' | 'mobile' | 'mobile-landscape';

const FORCE_KEY = 'clip-to-track:force-layout';
const Q_LANDSCAPE = '(max-height: 500px) and (pointer: coarse)'; // phone held sideways
const Q_PORTRAIT = '(max-width: 820px)';

/** `?mobile=1` or localStorage `clip-to-track:force-layout` = mobile | mobile-landscape | desktop (devtools testing). */
function forced(): LayoutMode | null {
  try {
    if (new URLSearchParams(location.search).get('mobile') === '1')
      return 'mobile';
    const s = localStorage.getItem(FORCE_KEY);
    if (s === 'mobile' || s === 'mobile-landscape' || s === 'desktop') return s;
  } catch {
    /* ignore */
  }
  return null;
}

function read(): LayoutMode {
  const f = forced();
  if (f) return f;
  // landscape first: a 667px-wide phone on its side matches both queries
  if (matchMedia(Q_LANDSCAPE).matches) return 'mobile-landscape';
  if (matchMedia(Q_PORTRAIT).matches) return 'mobile';
  return 'desktop';
}

function subscribe(cb: () => void) {
  const lists = [matchMedia(Q_LANDSCAPE), matchMedia(Q_PORTRAIT)];
  lists.forEach((l) => l.addEventListener('change', cb));
  return () => lists.forEach((l) => l.removeEventListener('change', cb));
}

/** One mode for the whole app; the DOM tree never changes, only `data-layout` does. */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, read, () => 'desktop');
}
