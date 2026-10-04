import { useEffect, useRef, useState } from 'react';
import SvgIcon from './SvgIcon';
import { detectBrowser, type BrowserInfo } from './videoSupport';
import './PlaybackHelp.css';

const KEY = 'clip-to-track:playback-help-dismissed';
export const playbackHelpDismissed = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

type Step = { text: string; copy?: string };

/** Browser-specific one-time approvals. Web pages can't change browser settings or open chrome:// pages, so the user does it. */
function stepsFor(b: BrowserInfo): Step[] {
  const scheme = b.family === 'edge' ? 'edge' : 'chrome';
  if (b.family === 'chrome' || b.family === 'edge') {
    if (b.os === 'windows')
      return [
        {
          text: `Update ${b.name} to the latest version (HEVC playback arrived in version 107).`,
        },
        {
          text: 'Turn on hardware acceleration: Settings → System → "Use graphics acceleration when available", then relaunch.',
          copy: `${scheme}://settings/system`,
        },
        {
          text: 'Install "HEVC Video Extensions" from the Microsoft Store (the free "…from Device Manufacturer" version also works), then restart the browser.',
        },
        {
          text: 'Only if you changed it before: the flag "Hardware-accelerated video decode" must be Default, not Disabled.',
          copy: `${scheme}://flags/#disable-accelerated-video-decode`,
        },
        {
          text: 'Check it worked: under "Video Acceleration Information" you should see "Decode hevc main 10".',
          copy: `${scheme}://gpu`,
        },
      ];
    if (b.os === 'mac')
      return [
        {
          text: `Update ${b.name} and macOS; HEVC is decoded by macOS itself.`,
        },
        {
          text: 'Make sure hardware acceleration is on: Settings → System → "Use graphics acceleration when available".',
          copy: `${scheme}://settings/system`,
        },
      ];
    return [
      {
        text: 'On Linux, HEVC needs VA-API hardware decoding, which most browsers do not enable. The simplest fix is the .LRV proxy or an H.264 copy (below).',
      },
    ];
  }
  if (b.family === 'firefox')
    return [
      {
        text: 'Use Firefox 133 or newer (HEVC is Windows only, and needs the Microsoft Store "HEVC Video Extensions").',
      },
      {
        text: 'In about:config make sure media.wmf.hevc.enabled is not turned off.',
        copy: 'about:config',
      },
    ];
  if (b.family === 'safari')
    return [
      { text: 'Safari plays HEVC natively. Update macOS / Safari and reload.' },
    ];
  return [
    {
      text: 'Use a current Chrome or Edge (Windows / macOS) or Safari (macOS) with hardware acceleration on.',
    },
  ];
}

function CopyChip({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="ctt-ph-copy"
      title="Browsers don't allow websites to open this page, so copy the address and paste it into a new tab"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      <code>{value}</code>
      <span>{done ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** Explains (once) why the picture is black and what to approve in the browser. */
export default function PlaybackHelp({ onClose }: { onClose: () => void }) {
  const browser = detectBrowser();
  const [never, setNever] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);

  const close = () => {
    if (never) {
      try {
        localStorage.setItem(KEY, '1');
      } catch {
        /* ignore */
      }
    }
    onClose();
  };
  useEffect(() => {
    ok.current?.focus();
  }, []);

  return (
    <div
      className="ctt-ph-backdrop"
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <div
        className="ctt-ph"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ctt-ph-title"
      >
        <header>
          <SvgIcon name="info" size={18} />
          <h2 id="ctt-ph-title">
            Your browser needs your OK to show this video
          </h2>
        </header>

        <p>
          The clip was added, but {browser.name} can't draw its picture (you'd
          see a black square with sound). GoPro records HEVC (H.265), 10-bit, up
          to 5.3K. Browsers don't ship their own HEVC decoder; they borrow the
          one in your computer, and it has to be installed, switched on and
          powerful enough for 5.3K.
        </p>
        <p>
          This page can't switch that on for you: websites aren't allowed to
          change browser settings or flags, or to open <code>chrome://</code>{' '}
          pages. It needs a one-time approval from you:
        </p>

        <ol className="ctt-ph-steps">
          {stepsFor(browser).map((s) => (
            <li key={s.text}>
              {s.text}
              {s.copy && <CopyChip value={s.copy} />}
            </li>
          ))}
        </ol>

        <p className="ctt-ph-alt">
          <b>No change needed:</b> add the small <code>.LRV</code> file the
          camera saves next to each MP4 (H.264, plays everywhere), or convert
          the clip to H.264 with HandBrake / ffmpeg. The route and stats work
          either way.
        </p>

        <footer>
          <label>
            <input
              type="checkbox"
              checked={never}
              onChange={(e) => setNever(e.target.checked)}
            />
            Don't show this again
          </label>
          <button ref={ok} className="ctt-ph-ok" onClick={close}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
