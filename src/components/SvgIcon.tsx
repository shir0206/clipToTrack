import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'play' | 'pause' | 'stop' | 'maximize' | 'close' | 'upload' | 'trash'
  | 'clock' | 'route' | 'gauge' | 'mountain' | 'camera' | 'gps' | 'info' | 'chevron';

const solid = { fill: 'currentColor', stroke: 'none' } as const;

const PATHS: Record<IconName, ReactNode> = {
  play: <polygon points="7 4 20 12 7 20 7 4" {...solid} />,
  pause: (
    <g {...solid}>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </g>
  ),
  stop: <rect x="5" y="5" width="14" height="14" rx="2" {...solid} />,
  maximize: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  upload: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  trash: <path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    </>
  ),
  gauge: <path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0" />,
  mountain: <path d="m8 3 4 8 5-5 5 15H2L8 3z" />,
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  gps: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
};

type Props = { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>;

/** Single place that draws every icon: <SvgIcon name="play" size={16} /> */
export default function SvgIcon({ name, size = 16, className, ...rest }: Props) {
  return (
    <svg
      className={`ctt-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
