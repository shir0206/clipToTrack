import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Clip } from '../../types';
import type { MapCaptureSource } from '../TrackMap/TrackMap';
import SpeedCluster from '../SpeedCluster/SpeedCluster';
import { speedometerTimeline } from '../../lib/mapCapture/speedometerTimeline';

/** Serialize only the dashboard, resolving its styles so no UI or remote assets enter the video. */
async function dashboardImage(element: HTMLElement): Promise<HTMLImageElement> {
  const clone = element.cloneNode(true) as HTMLElement;
  const originals = [element, ...element.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const pseudoRules: string[] = [];
  originals.forEach((original, i) => {
    const copy = copies[i] as HTMLElement | SVGElement;
    const computed = getComputedStyle(original);
    const styles = (style: CSSStyleDeclaration) =>
      Array.from(style)
        .map((key) => `${key}:${style.getPropertyValue(key)}`)
        .join(';')
        .replace(/url\(["']?[^)"']*#([^)"']+)["']?\)/g, 'url(#$1)');
    copy.setAttribute(
      'style',
      `${styles(computed)};transition:none;animation:none`,
    );
    if (original instanceof HTMLElement) {
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(original, pseudo);
        if (style.content !== 'none' && style.content !== 'normal') {
          const name = `export-node-${i}`;
          copy.classList.add(name);
          pseudoRules.push(
            `.${name}${pseudo}{${styles(style)};transition:none;animation:none}`,
          );
        }
      }
    }
  });
  clone.style.position = 'relative';
  clone.style.inset = 'auto';
  clone.style.margin = '0';
  const { width, height } = element.getBoundingClientRect();
  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${pseudoRules.join('')}</style>${markup}</div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  return image;
}

export function createSpeedometerSource(
  clip: Clip,
  element: HTMLElement,
  startProbe: number,
  zoom: number,
  startSeconds?: number,
  getCurrentTime?: () => number,
): { source: MapCaptureSource; dispose: () => void } {
  const timeline = speedometerTimeline(clip.samples, clip.sort.duration ?? 0);
  const startTime = Math.max(
    0,
    Math.min(
      startSeconds ?? timeline.timeAt(startProbe),
      getCurrentTime ? Infinity : timeline.duration - 0.04,
    ),
  );
  const box = element.getBoundingClientRect();
  const host = document.createElement('div');
  host.className = 'speedometer-export';
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${box.width}px`,
    height: `${box.height}px`,
    display: 'flex',
    pointerEvents: 'none',
  });
  const inherited = getComputedStyle(element);
  for (const name of Array.from(inherited)) {
    if (name.startsWith('--'))
      host.style.setProperty(name, inherited.getPropertyValue(name));
  }
  host.style.fontFamily = inherited.fontFamily;
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const root = createRoot(host);
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    root.unmount();
    host.remove();
    throw new Error('Cannot create the speedometer recording canvas.');
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    },
    source: {
      canvas,
      getPlaybackSeconds: getCurrentTime
        ? () => Math.max(0, getCurrentTime() - startTime)
        : undefined,
      subscribeRender: () => () => {},
      requestRender: () => {},
      async renderFrame(seconds) {
        if (
          disposed ||
          (!getCurrentTime && startTime + seconds >= timeline.duration)
        )
          return false;
        const { sample, probe } = timeline.at(startTime + seconds);
        flushSync(() =>
          root.render(
            <SpeedCluster clip={clip} probe={probe} sample={sample} />,
          ),
        );
        const dashboard = host.firstElementChild as HTMLElement;
        const image = await dashboardImage(dashboard);
        if (disposed) return false;
        const scale = Math.min(1920 / box.width, 1080 / box.height) * zoom;
        const width = box.width * scale;
        const height = box.height * scale;
        context.fillStyle = '#000';
        context.fillRect(0, 0, 1920, 1080);
        context.drawImage(
          image,
          (1920 - width) / 2,
          (1080 - height) / 2,
          width,
          height,
        );
        return true;
      },
    },
  };
}
