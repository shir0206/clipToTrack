type Props = {
  size?: number;
  /** show the "clip to track" wordmark next to the mark */
  wordmark?: boolean;
  tagline?: string;
  /** phone app bar: smaller mark, no tagline */
  compact?: boolean;
};

/** App mark (play button + GPS route) with an optional wordmark. */
export default function Logo({
  size = 36,
  wordmark = true,
  tagline,
  compact = false,
}: Props) {
  return (
    <div className={`app-brand${compact ? ' is-compact' : ''}`}>
      <svg
        width={compact ? Math.min(size, 30) : size}
        height={compact ? Math.min(size, 30) : size}
        viewBox="0 0 383.92859 372.18396"
        fill="none"
        version="1.1"
        id="svg9"
      >
        <defs>
          <clipPath id="playClip">
            <path
              d="m 106,82 c 0,-27 30,-44 54,-30 l 247,141 c 26,15 26,53 0,68 L 160,402 c -24,14 -54,-3 -54,-30 z"
              id="path1"
            />
          </clipPath>
        </defs>
        <g
          clipPath="url(#playClip)"
          id="g2"
          transform="translate(-87.173325,-34.832696)"
        >
          <rect
            width="512"
            height="512"
            fill="var(--color-brand-blue, #2468f2)"
            id="rect1"
            x="0"
            y="0"
          />
          <path
            d="m 80,355 c 52,-61 81,-129 128,-128 52,1 76,34 129,14 38,-14 69,-49 118,-41 l 57,312 H 0 Z"
            fill="var(--color-brand-pink, #f5388a)"
            id="path2"
          />
        </g>
        <path
          d="m 47.437665,280.28308 c 9.48146,-32.42532 26.33736,-61.3452 53.728215,-93.77052 38.97929,11.39268 79.01207,22.78536 120.09835,17.52721 41.08627,-5.25817 74.7981,-22.78536 100.08196,-47.32344"
          stroke="var(--color-brand-white, #ffffff)"
          strokeWidth="23.0605"
          strokeLinecap="round"
          strokeLinejoin="round"
          id="path3"
        />
        <ellipse
          cx="46.826675"
          cy="271.1673"
          fill="var(--color-brand-white, #ffffff)"
          id="circle3"
          rx="46.826675"
          ry="45.401489"
          style={{ strokeWidth: 1.35613 }}
        />
        <ellipse
          cx="46.826675"
          cy="271.1673"
          fill="var(--color-brand-blue, #2468f2)"
          id="circle4"
          rx="23.413338"
          ry="22.700745"
          style={{ strokeWidth: 1.35613 }}
        />
        <ellipse
          cx="99.210205"
          cy="175.98419"
          fill="var(--color-brand-white, #ffffff)"
          id="circle5"
          rx="36.266079"
          ry="37.121189"
          style={{ strokeWidth: 1.3104 }}
        />
        <ellipse
          cx="99.210205"
          cy="175.98419"
          fill="var(--color-brand-blue, #2468f2)"
          id="circle6"
          rx="16.837822"
          ry="17.234838"
          style={{ strokeWidth: 1.3104 }}
        />
        <ellipse
          cx="318.4754"
          cy="161.94391"
          fill="var(--color-brand-white, #ffffff)"
          id="circle7"
          rx="45.668476"
          ry="45.491039"
          style={{ strokeWidth: 1.89915 }}
        />
        <ellipse
          cx="318.4754"
          cy="162.79555"
          fill="var(--color-brand-blue, #2468f2)"
          id="circle8"
          rx="19.028534"
          ry="19.806234"
          style={{ strokeWidth: 1.94134 }}
        />
        <path
          d="m 319.28162,0 c -36.24148,0 -64.64697,27.58176 -64.64697,62.772281 0,45.652569 64.64697,95.109519 64.64697,95.109519 0,0 64.64697,-49.45695 64.64697,-95.109519 C 383.92859,27.58176 355.5231,0 319.28162,0 Z"
          fill="var(--color-brand-orange, #ff7a1a)"
          id="path8"
          style={{ strokeWidth: 0.965193 }}
        />
        <circle
          cx="320.18365"
          cy="61.940891"
          r="22"
          fill="var(--color-brand-white, #ffffff)"
          id="circle9"
        />
      </svg>

      {wordmark && (
        <div className="brand-name">
          <span className="logo-text">
            <b>Clip</b>
            <i>to</i>
            <b className="logo-accent">Track</b>
          </span>
          {tagline && !compact && (
            <span className="brand-tagline">{tagline}</span>
          )}
        </div>
      )}
    </div>
  );
}
