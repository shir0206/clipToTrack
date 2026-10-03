import { ROUTE_COLORS } from './types';

type Props = {
  size?: number;
  /** show the "clip to track" wordmark next to the mark */
  wordmark?: boolean;
  tagline?: string;
};

/** App mark (play button + GPS route) with an optional wordmark. */
export default function Logo({ size = 36, wordmark = true, tagline }: Props) {
  return (
    <div className="ctt-brand">
      <svg
        className="ctt-mark"
        width={size}
        height={size}
        viewBox="0 0 48 48"
        role="img"
        aria-label="clip to track"
      >
        <rect width="48" height="48" rx="12" fill={ROUTE_COLORS[0]} />
        <path
          d="M9 37C18 37 15 25 24 25S31 13 38 12"
          fill="none"
          stroke="#fff"
          strokeOpacity=".55"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="1 5.5"
        />
        <path
          d="M17 12.5v17a1.5 1.5 0 0 0 2.3 1.3l13.4-8.5a1.5 1.5 0 0 0 0-2.6L19.3 11.2A1.5 1.5 0 0 0 17 12.5z"
          fill="#fff"
        />
        <circle cx="9" cy="37" r="3.2" fill="#fff" />
        <circle
          cx="38"
          cy="12"
          r="4.4"
          fill={ROUTE_COLORS[1]}
          stroke="#fff"
          strokeWidth="2"
        />
      </svg>
      {wordmark && (
        <div className="ctt-brand-text">
          <span className="ctt-logo">
            <b>clip</b>
            <i>to</i>
            <b style={{ color: ROUTE_COLORS[0] }}>track</b>
          </span>
          {tagline && <span className="ctt-tagline">{tagline}</span>}
        </div>
      )}
    </div>
  );
}
