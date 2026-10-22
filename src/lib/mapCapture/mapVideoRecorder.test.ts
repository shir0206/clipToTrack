import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkMapCaptureSupport,
  createMapVideoRecorder,
  MAP_RECORDING_LIMITS,
  type MapVideoRecorderOptions,
} from './mapVideoRecorder';

const harness = vi.hoisted(() => ({
  events: [] as string[],
  packetBytes: 8,
  hold: false,
  failDraw: false,
  supported: true,
  throwConfigure: false,
  dropOutput: false,
  frames: [] as { timestamp: number; duration: number; closed: boolean }[],
  encoders: [] as FakeEncoder[],
}));
vi.mock('mediabunny', () => ({
  BufferTarget: class {
    buffer = new Uint8Array([1, 2, 3]).buffer;
  },
  Mp4OutputFormat: class {},
  Output: class {
    addVideoTrack() {}
    async start() {}
    async finalize() {
      harness.events.push('finalize');
    }
    async cancel() {
      harness.events.push('cancel');
    }
  },
  EncodedVideoPacketSource: class {
    async add() {
      harness.events.push('write');
    }
    close() {
      harness.events.push('source-close');
    }
  },
  EncodedPacket: { fromEncodedChunk: (chunk: unknown) => chunk },
}));
class FakeFrame {
  timestamp: number;
  duration: number;
  closed = false;
  constructor(
    _canvas: unknown,
    options: { timestamp: number; duration: number },
  ) {
    this.timestamp = options.timestamp;
    this.duration = options.duration;
    harness.frames.push(this);
  }
  close() {
    this.closed = true;
  }
}
class FakeEncoder {
  static async isConfigSupported() {
    return { supported: harness.supported };
  }
  state = 'configured';
  encodeQueueSize = 0;
  pending: FakeFrame[] = [];
  constructor(
    readonly callbacks: {
      output: (chunk: unknown) => void;
      error: (error: Error) => void;
    },
  ) {
    harness.encoders.push(this);
  }
  configure() {
    if (harness.throwConfigure)
      throw new Error('Encoder initialization failed');
  }
  encode(frame: FakeFrame) {
    this.encodeQueueSize++;
    this.pending.push(frame);
    if (!harness.hold) queueMicrotask(() => this.drain());
  }
  drain() {
    for (const frame of this.pending.splice(0)) {
      this.encodeQueueSize--;
      if (harness.dropOutput) continue;
      this.callbacks.output({
        timestamp: frame.timestamp,
        duration: frame.duration,
        byteLength: harness.packetBytes,
      });
    }
  }
  async flush() {
    harness.events.push('flush');
    this.drain();
  }
  close() {
    this.state = 'closed';
    harness.events.push('encoder-close');
  }
}
function setup(render = true) {
  let listener: (() => void) | undefined;
  const canvas = { width: 1920, height: 1080 } as HTMLCanvasElement;
  const unsubscribe = vi.fn(() => {
    listener = undefined;
  });
  const options: MapVideoRecorderOptions = {
    canvas,
    crop: { x: 0, y: 0, width: 1920, height: 1080 },
    subscribeRender: (callback) => {
      listener = callback;
      return unsubscribe;
    },
    requestRender: () => {
      if (render) listener?.();
    },
    setRecordingActive: vi.fn(),
    onError: vi.fn(),
    onStopped: vi.fn(),
  };
  return { options, unsubscribe, render: () => listener?.() };
}
beforeEach(() => {
  vi.useFakeTimers();
  harness.events = [];
  harness.frames = [];
  harness.encoders = [];
  harness.hold = false;
  harness.packetBytes = 8;
  harness.failDraw = false;
  harness.supported = true;
  harness.throwConfigure = false;
  harness.dropOutput = false;
  const context = {
    fillRect() {},
    fillText() {},
    measureText: (text: string) => ({ width: text.length * 10 }),
    drawImage() {
      if (harness.failDraw)
        throw new DOMException('Canvas is tainted', 'SecurityError');
    },
  };
  vi.stubGlobal('window', {
    isSecureContext: true,
    setInterval,
    clearInterval,
    setTimeout,
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  vi.stubGlobal('VideoFrame', FakeFrame);
  vi.stubGlobal('VideoEncoder', FakeEncoder);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('map video recorder', () => {
  it('samples deterministic sources at media time even when rendering is slow', async () => {
    const { options } = setup();
    const times: number[] = [];
    options.renderFrame = async (seconds) => {
      times.push(seconds);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return seconds < 0.12;
    };
    const recorder = await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(600);
    const result = await recorder.stop();
    expect(times).toEqual([0, 0.04, 0.08, 0.12]);
    expect(result.durationSeconds).toBe(0.12);
    expect(result.frameCount).toBe(3);
    expect(options.onStopped).toHaveBeenCalledOnce();
  });

  it('paces live rendering and finalizes exactly the interval before pause', async () => {
    const { options } = setup();
    const progress: number[] = [];
    options.onFinalizationProgress = (percent) => progress.push(percent);
    let playbackSeconds = 0;
    const times: number[] = [];
    options.getPlaybackSeconds = () => playbackSeconds;
    options.renderFrame = async (seconds) => {
      times.push(seconds);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    };
    const recorder = await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(500);
    expect(times).toEqual([0]); // never renders ahead of playback
    playbackSeconds = 0.2;
    await vi.advanceTimersByTimeAsync(20);
    const stopped = recorder.stop();
    await vi.advanceTimersByTimeAsync(1000);
    const recording = await stopped;
    expect(recording.durationSeconds).toBe(0.2);
    expect(recording.frameCount).toBe(5);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress.some((percent) => percent > 0 && percent < 95)).toBe(true);
    expect(
      progress.every((percent, i) => i === 0 || percent >= progress[i - 1]),
    ).toBe(true);
    expect(times).toContain(0.16); // renders pending telemetry during finalization
    expect(times.every((time) => time < 0.2)).toBe(true);
  });

  it('discards an asynchronous deterministic frame after cancellation', async () => {
    const { options } = setup();
    let complete!: (value: boolean) => void;
    options.renderFrame = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    const recorder = await createMapVideoRecorder(options);
    recorder.cancel();
    complete(true);
    await Promise.resolve();
    expect(harness.frames).toHaveLength(1); // capability probe only
    expect(options.onStopped).not.toHaveBeenCalled();
    await expect(recorder.ready).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('encodes exactly 25 evenly spaced frames for one second and flushes before finalizing', async () => {
    const { options, unsubscribe } = setup();
    const recorder = await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(1000);
    const first = recorder.stop();
    expect(recorder.stop()).toBe(first);
    const result = await first;
    expect(result).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 25,
      frameCount: 25,
      durationSeconds: 1,
    });
    expect(result.blob.type).toBe('video/mp4');
    const frames = harness.frames.slice(1); // capability probe creates one disposable frame
    expect(frames.map((frame) => frame.timestamp)).toEqual(
      Array.from({ length: 25 }, (_, i) => i * 40_000),
    );
    expect(
      frames.every((frame) => frame.closed && frame.duration === 40_000),
    ).toBe(true);
    expect(harness.events.indexOf('flush')).toBeLessThan(
      harness.events.indexOf('finalize'),
    );
    expect(harness.events.lastIndexOf('write')).toBeLessThan(
      harness.events.indexOf('finalize'),
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(options.setRecordingActive).toHaveBeenLastCalledWith(false);
  });
  it('signals readiness only after submitting the initial map frame', async () => {
    const { options, render } = setup(false);
    const recorder = await createMapVideoRecorder(options);
    let ready = false;
    void recorder.ready.then(() => {
      ready = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(false);
    render();
    await recorder.ready;
    expect(harness.frames.at(-1)).toMatchObject({
      timestamp: 0,
      duration: 40_000,
      closed: true,
    });
    recorder.cancel();
  });
  it('retains the timeline when stopped during encoder warmup', async () => {
    harness.hold = true;
    const { options } = setup();
    const recorder = await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(600);
    expect((await recorder.stop()).durationSeconds).toBe(0.6);
  });
  it('cancels without returning a recording and releases all resources', async () => {
    const { options, unsubscribe } = setup();
    const recorder = await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(50);
    recorder.cancel();
    recorder.cancel();
    await expect(recorder.stop()).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.events).not.toContain('finalize');
    expect(options.onStopped).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(
      harness.encoders.every((encoder) => encoder.state === 'closed'),
    ).toBe(true);
  });
  it('rejects an empty capture and clears subscriptions', async () => {
    const { options, unsubscribe } = setup(false);
    const recorder = await createMapVideoRecorder(options);
    await expect(recorder.stop()).rejects.toThrow('No map frames');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports canvas security errors without finalizing an invalid file', async () => {
    const { options, render } = setup();
    const recorder = await createMapVideoRecorder(options);
    harness.failDraw = true;
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SecurityError' }),
    );
    expect(harness.events).not.toContain('finalize');
    recorder.cancel();
  });
  it('handles asynchronous encoder failure and initialization failure', async () => {
    const { options } = setup();
    const recorder = await createMapVideoRecorder(options);
    harness.encoders[0].callbacks.error(new Error('Device encoder failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Device encoder failed' }),
    );
    recorder.cancel();
    harness.throwConfigure = true;
    await expect(createMapVideoRecorder(setup().options)).rejects.toThrow(
      'initialization',
    );
    expect(
      harness.encoders.every((encoder) => encoder.state === 'closed'),
    ).toBe(true);
  });
  it('automatically retains completed frames after source resize', async () => {
    const { options, render } = setup();
    await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(200);
    options.canvas.width = 1000;
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onStopped).toHaveBeenCalledWith(
      expect.objectContaining({ frameCount: 5 }),
      'The map size changed.',
    );
  });
  it('stops after persistent saturation without growing its queue beyond ten frames', async () => {
    harness.hold = true;
    const { options } = setup();
    await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(1500);
    expect(options.onStopped).toHaveBeenCalledWith(
      expect.objectContaining({ frameCount: 10 }),
      expect.stringContaining('could not keep up'),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops at the encoded-byte threshold', async () => {
    harness.packetBytes = MAP_RECORDING_LIMITS.encodedBytes;
    const { options } = setup();
    await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(100);
    expect(options.onStopped).toHaveBeenCalledWith(
      expect.objectContaining({ frameCount: 1 }),
      expect.stringContaining('256 MiB'),
    );
  });
  it('stops at five minutes with at most 7500 frames', async () => {
    const { options } = setup();
    await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(options.onStopped).toHaveBeenCalledWith(
      expect.objectContaining({ frameCount: 7500, durationSeconds: 300 }),
      expect.stringContaining('five-minute'),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a map that never renders', async () => {
    const { options } = setup(false);
    await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(10_020);
    expect(options.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('did not render'),
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports unsupported H.264, missing APIs, and insecure contexts', async () => {
    harness.supported = false;
    expect((await checkMapCaptureSupport()).supported).toBe(false);
    await expect(createMapVideoRecorder(setup().options)).rejects.toThrow(
      'cannot encode',
    );
    vi.stubGlobal('VideoEncoder', undefined);
    expect((await checkMapCaptureSupport()).reason).toContain(
      'does not support',
    );
    vi.stubGlobal('window', { isSecureContext: false });
    expect((await checkMapCaptureSupport()).reason).toContain('HTTPS');
  });
  it('rejects dropped encoder frames instead of returning an incomplete timeline', async () => {
    harness.dropOutput = true;
    const { options } = setup();
    const recorder = await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(200);
    await expect(recorder.stop()).rejects.toThrow('dropped frames');
    expect(harness.events).not.toContain('finalize');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancellation during finalization rejects the pending Stop', async () => {
    const { options } = setup();
    const recorder = await createMapVideoRecorder(options);
    await vi.advanceTimersByTimeAsync(200);
    const result = recorder.stop();
    recorder.cancel();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(options.onError).not.toHaveBeenCalled();
    expect(harness.events).not.toContain('finalize');
  });
  it('rejects invalid crops before acquiring encoder resources', async () => {
    const { options } = setup();
    options.crop.x = -1;
    await expect(createMapVideoRecorder(options)).rejects.toThrow(RangeError);
    expect(harness.encoders).toHaveLength(0);
  });
});
