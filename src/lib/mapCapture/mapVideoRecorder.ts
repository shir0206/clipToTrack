/** Shared by capability detection and the recorder so they cannot drift apart. */
export const MAP_VIDEO_CONFIG = {
  codec: 'avc1.420028', // H.264 baseline, level 4.0: 1080p at 25 fps.
  width: 1920,
  height: 1080,
  framerate: 25,
  bitrate: 8_000_000,
  latencyMode: 'realtime',
  avc: { format: 'avc' },
} as const satisfies VideoEncoderConfig;

export type MapCaptureSupport = { supported: boolean; reason?: string };

export async function checkMapCaptureSupport(): Promise<MapCaptureSupport> {
  if (typeof window === 'undefined' || !window.isSecureContext)
    return {
      supported: false,
      reason: 'Map recording requires HTTPS or localhost.',
    };
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof VideoEncoder.isConfigSupported !== 'function' ||
    typeof VideoFrame === 'undefined'
  )
    return {
      supported: false,
      reason:
        'This browser does not support video encoding. Try a current version of Chrome or Edge.',
    };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = MAP_VIDEO_CONFIG.width;
    canvas.height = MAP_VIDEO_CONFIG.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillRect(0, 0, canvas.width, canvas.height);
    const frame = new VideoFrame(canvas, { timestamp: 0, duration: 40_000 });
    frame.close();
    const { supported } =
      await VideoEncoder.isConfigSupported(MAP_VIDEO_CONFIG);
    return supported
      ? { supported: true }
      : {
          supported: false,
          reason:
            'This browser cannot encode 1920 × 1080 H.264 at 25 fps. Try another browser or device.',
        };
  } catch {
    return {
      supported: false,
      reason:
        'Video encoding is unavailable on this device. Try another browser or device.',
    };
  }
}

/** Call when capture opens, keeping the muxer out of initial page loading. */
export const loadMapVideoMuxer = () => import('mediabunny');

export type MapRecording = {
  blob: Blob;
  durationSeconds: number;
  frameCount: number;
  width: 1920;
  height: 1080;
  fps: 25;
};

export const MAP_RECORDING_LIMITS = {
  seconds: 300,
  encodedBytes: 256 * 1024 * 1024,
  queuedFrames: 10,
  saturationMs: 1000,
} as const;

export type MapVideoRecorderOptions = {
  canvas: HTMLCanvasElement;
  /** Deterministic sources render the requested media time before each encode. False ends the clip. */
  renderFrame?: (seconds: number) => Promise<boolean>;
  /** Live sources expose elapsed playback time. Rendering must never run ahead of it. */
  getPlaybackSeconds?: () => number;
  crop: import('./captureGeometry').CaptureRect;
  /** Invoke the listener synchronously in MapLibre's render event, before WebGL clears. */
  subscribeRender: (listener: () => void) => () => void;
  requestRender: () => void;
  /** Disable the mobile playhead throttle for the lifetime of this recording. */
  setRecordingActive?: (active: boolean) => void;
  onStatus?: (
    status: 'recording' | 'finalizing' | 'stopped' | 'canceled',
  ) => void;
  onProgress?: (seconds: number) => void;
  /** Work completed while rendering pending frames and packaging the MP4 (0–100). */
  onFinalizationProgress?: (percent: number) => void;
  /** Automatic stops only; callers obtain manual stops from stop(). */
  onStopped?: (recording: MapRecording, reason: string) => void;
  onError?: (error: Error) => void;
};

export type MapVideoRecorder = {
  /** Resolves after the initial map composition has been submitted to the encoder. */
  ready: Promise<void>;
  stop: () => Promise<MapRecording>;
  cancel: () => void;
};

export async function createMapVideoRecorder(
  options: MapVideoRecorderOptions,
): Promise<MapVideoRecorder> {
  const support = await checkMapCaptureSupport();
  if (!support.supported) throw new Error(support.reason);
  const { canvas, requestRender } = options;
  const crop = { ...options.crop }; // callers must not mutate an in-flight crop
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  if (
    !Object.values(crop).every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > sourceWidth + 0.001 ||
    crop.y + crop.height > sourceHeight + 0.001 ||
    Math.abs(crop.width / crop.height - 16 / 9) > 0.01
  )
    throw new RangeError(
      'The capture crop must be a 16:9 rectangle inside the map canvas.',
    );

  const muxer = await loadMapVideoMuxer();
  let target: InstanceType<typeof muxer.BufferTarget> | null =
    new muxer.BufferTarget();
  let output: InstanceType<typeof muxer.Output> | null = new muxer.Output({
    format: new muxer.Mp4OutputFormat(),
    target,
  });
  let source: InstanceType<typeof muxer.EncodedVideoPacketSource> | null =
    new muxer.EncodedVideoPacketSource('avc');
  output.addVideoTrack(source, { frameRate: 25 });
  let composition: HTMLCanvasElement | null = document.createElement('canvas');
  composition.width = 1920;
  composition.height = 1080;
  let context = composition.getContext('2d', { alpha: false });
  if (!context) throw new Error('Cannot create the map recording canvas.');
  context.imageSmoothingQuality = 'high';

  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  let state: 'recording' | 'finalizing' | 'stopped' | 'canceled' = 'recording';
  let encoder: VideoEncoder | null = null;
  let unsubscribe: (() => void) | undefined;
  let timer: number | undefined;
  let startedAt: number | null = null;
  let frameCount = 0;
  let encodedBytes = 0;
  let encodedFrames = 0;
  let pendingPackets = 0;
  let saturatedAt: number | null = null;
  let pendingWrites = Promise.resolve();
  let failure: Error | null = null;
  let stopPromise: Promise<MapRecording> | undefined;
  let reportedSecond = -1;
  let preserveTimeline = !options.renderFrame;
  let rendering: Promise<boolean> | null = null;
  const isCanceled = () => state === 'canceled';
  const abortError = () =>
    new DOMException('Map recording canceled.', 'AbortError');

  const stopCapture = () => {
    window.clearInterval(timer);
    timer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    options.setRecordingActive?.(false);
  };
  const release = () => {
    if (encoder && encoder.state !== 'closed') encoder.close();
    encoder = null;
    source = null;
    target = null;
    output = null;
    if (composition) composition.width = composition.height = 0;
    context = null;
    composition = null;
  };
  const cancel = () => {
    if (state === 'stopped' || state === 'canceled') return;
    state = 'canceled';
    rejectReady(abortError());
    stopCapture();
    void output?.cancel().catch(() => {});
    release();
    options.onStatus?.('canceled');
  };
  const encodeFrame = () => {
    const frame = new VideoFrame(composition!, {
      timestamp: frameCount * 40_000,
      duration: 40_000,
    });
    try {
      encoder!.encode(frame, { keyFrame: frameCount % 50 === 0 });
    } finally {
      frame.close();
    }
    frameCount++;
  };
  const stop = (): Promise<MapRecording> => {
    if (stopPromise) return stopPromise;
    if (state === 'canceled') return Promise.reject(abortError());
    const playbackSeconds = options.getPlaybackSeconds?.();
    const finalFrameCount =
      playbackSeconds !== undefined
        ? Math.min(
            7500,
            Math.max(frameCount, Math.ceil(playbackSeconds * 25 - 0.000001)),
          )
        : preserveTimeline && startedAt !== null
          ? Math.min(
              7500,
              Math.max(
                frameCount,
                Math.ceil((performance.now() - startedAt) / 40),
              ),
            )
          : frameCount;
    state = 'finalizing';
    options.onFinalizationProgress?.(0);
    const reportFinalization = () =>
      options.onFinalizationProgress?.(
        Math.min(
          95,
          Math.floor((frameCount / Math.max(1, finalFrameCount)) * 95),
        ),
      );
    stopCapture();
    stopPromise = (async () => {
      try {
        if (rendering) await rendering;
        if (isCanceled()) throw abortError();
        if (failure) throw failure;
        if (!frameCount && startedAt !== null) encodeFrame();
        if (!frameCount)
          throw new Error(
            'No map frames were captured. Wait for the map to render and try again.',
          );
        await encoder!.flush();
        await pendingWrites;
        if (isCanceled()) throw abortError();
        if (failure) throw failure;
        reportFinalization();
        // A short recording can stop during encoder warmup. Finish its timeline
        // using the last composition, in bounded batches rather than losing time.
        while (
          frameCount < finalFrameCount &&
          encodedBytes < MAP_RECORDING_LIMITS.encodedBytes
        ) {
          const end = Math.min(
            finalFrameCount,
            frameCount + MAP_RECORDING_LIMITS.queuedFrames,
          );
          while (frameCount < end) {
            if (options.renderFrame) {
              const available = await options.renderFrame(frameCount / 25);
              if (isCanceled()) throw abortError();
              if (!available) break;
              context!.drawImage(
                canvas,
                crop.x,
                crop.y,
                crop.width,
                crop.height,
                0,
                0,
                1920,
                1080,
              );
            }
            encodeFrame();
            reportFinalization();
          }
          const reachedEnd = frameCount < end;
          await encoder!.flush();
          await pendingWrites;
          if (isCanceled()) throw abortError();
          if (failure) throw failure;
          if (reachedEnd) break;
        }
        if (encodedFrames !== frameCount)
          throw new Error(
            'The video encoder dropped frames. Try another browser or device.',
          );
        options.onFinalizationProgress?.(99);
        source!.close();
        await output!.finalize();
        if (isCanceled()) throw abortError();
        const buffer = target!.buffer;
        if (!buffer?.byteLength)
          throw new Error('The recording did not produce a valid MP4.');
        const recording: MapRecording = {
          blob: new Blob([buffer], { type: 'video/mp4' }),
          durationSeconds: frameCount / 25,
          frameCount,
          width: 1920,
          height: 1080,
          fps: 25,
        };
        state = 'stopped';
        options.onFinalizationProgress?.(100);
        release();
        options.onStatus?.('stopped');
        return recording;
      } catch (error) {
        const wasCanceled = isCanceled();
        cancel();
        if (!wasCanceled)
          options.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        throw error;
      }
    })();
    options.onStatus?.('finalizing');
    return stopPromise;
  };
  const automaticStop = (reason: string, keepTimeline = true) => {
    if (state !== 'recording') return;
    preserveTimeline = keepTimeline;
    void stop()
      .then((recording) => options.onStopped?.(recording, reason))
      .catch(() => {});
  };
  const fail = (error: unknown) => {
    if (state === 'canceled' || state === 'stopped') return;
    failure ??= error instanceof Error ? error : new Error(String(error));
    rejectReady(failure);
    automaticStop(failure.message);
  };

  try {
    await output.start();
    encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (state === 'canceled') return;
        encodedFrames++;
        encodedBytes += chunk.byteLength;
        pendingPackets++;
        const packet = muxer.EncodedPacket.fromEncodedChunk(chunk);
        pendingWrites = pendingWrites
          .then(async () => {
            try {
              if (state !== 'canceled') await source!.add(packet, metadata);
            } finally {
              pendingPackets--;
            }
          })
          .catch(fail);
        if (encodedBytes >= MAP_RECORDING_LIMITS.encodedBytes)
          automaticStop('Recording reached the 256 MiB limit.', false);
      },
      error: fail,
    });
    encoder.configure(MAP_VIDEO_CONFIG);

    const waitingSince = performance.now();
    const tick = () => {
      if (state !== 'recording') return;
      const now = performance.now();
      if (startedAt === null && now - waitingSince > 10_000) {
        fail(
          new Error(
            'The map did not render. Wait for it to load and try again.',
          ),
        );
        return;
      }
      if (startedAt !== null) {
        const elapsed = now - startedAt;
        if (elapsed >= MAP_RECORDING_LIMITS.seconds * 1000) {
          automaticStop('Recording reached the five-minute limit.');
          return;
        }
        const due = Math.min(7500, Math.max(1, Math.ceil(elapsed / 40)));
        while (frameCount < due) {
          if (
            encoder!.encodeQueueSize + pendingPackets >=
            MAP_RECORDING_LIMITS.queuedFrames
          ) {
            saturatedAt ??= now;
            if (now - saturatedAt >= MAP_RECORDING_LIMITS.saturationMs)
              automaticStop(
                'Recording stopped because video encoding could not keep up.',
                false,
              );
            break;
          }
          saturatedAt = null;
          try {
            encodeFrame();
          } catch (error) {
            fail(error);
            return;
          }
        }
        const second = Math.floor(elapsed / 1000);
        if (second !== reportedSecond) {
          reportedSecond = second;
          options.onProgress?.(elapsed / 1000);
        }
      }
      try {
        requestRender();
      } catch (error) {
        fail(error);
      }
    };
    if (options.renderFrame) {
      options.onStatus?.('recording');
      void (async () => {
        try {
          while (state === 'recording' && frameCount < 7500) {
            if (
              frameCount &&
              options.getPlaybackSeconds &&
              frameCount / 25 >= options.getPlaybackSeconds()
            ) {
              await new Promise((resolve) => window.setTimeout(resolve, 20));
              continue;
            }
            rendering = options.renderFrame!(frameCount / 25);
            const available = await rendering;
            rendering = null;
            if (state !== 'recording') return;
            if (!available) {
              automaticStop('The clip ended.', false);
              return;
            }
            context!.drawImage(
              canvas,
              crop.x,
              crop.y,
              crop.width,
              crop.height,
              0,
              0,
              1920,
              1080,
            );
            encodeFrame();
            if (frameCount === 1) resolveReady();
            options.onProgress?.(
              options.getPlaybackSeconds?.() ?? frameCount / 25,
            );
            // Backpressure slows rendering, never the exported telemetry timeline.
            await encoder!.flush();
            await pendingWrites;
          }
          if (state === 'recording')
            automaticStop('Recording reached the five-minute limit.', false);
        } catch (error) {
          if (state === 'recording') fail(error);
        }
      })();
      return { stop, cancel, ready };
    }
    unsubscribe = options.subscribeRender(() => {
      if (state !== 'recording') return;
      if (canvas.width !== sourceWidth || canvas.height !== sourceHeight) {
        automaticStop('The map size changed.');
        return;
      }
      try {
        context!.drawImage(
          canvas,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          0,
          0,
          1920,
          1080,
        );
        if (startedAt === null) {
          startedAt = performance.now();
          encodeFrame();
          resolveReady();
        }
      } catch (error) {
        fail(error);
      }
    });
    options.setRecordingActive?.(true);
    options.onStatus?.('recording');
    timer = window.setInterval(tick, 10);
    tick();
    return { stop, cancel, ready };
  } catch (error) {
    cancel();
    throw error;
  }
}
