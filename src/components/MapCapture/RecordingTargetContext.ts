import { createContext } from 'react';
import type { CapturePlayback } from '../../lib/video/usePlaybackReporting';
import type { CaptureStartPosition } from '../../lib/video/prepareCapturePlayback';

export type RecordingTarget = 'map' | 'speedometer';
export const RecordingTargetContext = createContext<{
  target: RecordingTarget | null;
  owner?: string;
  headerHost?: HTMLElement | null;
  playback?: CapturePlayback;
  preparePlayback?: (
    clipId: string,
    position: CaptureStartPosition,
    signal: AbortSignal,
  ) => Promise<() => Promise<void>>;
  pausePlayback?: (clipId: string) => void;
  isPlaying?: (clipId: string) => boolean;
  getCurrentTime?: (clipId: string) => number | undefined;
  setTarget: (target: RecordingTarget | null, owner?: string) => void;
} | null>(null);
