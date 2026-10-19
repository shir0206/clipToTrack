import { expect, test, type Page } from '@playwright/test';

/** Control encoding for UI coverage; real codec coverage is separate below. */
async function mockRecorder(page: Page, supported = true, delayMs = 0) {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    Object.assign(window, {
      revokedCaptureUrls: [] as string[],
      canceledCaptures: 0,
    });
    URL.revokeObjectURL = (url: string) => {
      Object.assign(window, {
        revokedCaptureUrls: [
          ...(window as unknown as { revokedCaptureUrls: string[] })
            .revokedCaptureUrls,
          url,
        ],
      });
      original(url);
    };
  });
  await page.route('**/src/lib/mapCapture/mapVideoRecorder.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
      export async function checkMapCaptureSupport() { return { supported: ${supported}, reason: 'Test browser cannot encode H.264.' }; }
      export async function createMapVideoRecorder(options) {
        await new Promise(resolve => setTimeout(resolve, ${delayMs}));
        let result;
        const ready = new Promise(resolve => setTimeout(() => { window.captureFirstFrameReady = true; resolve(); }, 30));
        options.setRecordingActive?.(true);
        return {
          ready,
          stop() {
            options.setRecordingActive?.(false);
            options.onStatus?.('finalizing');
            return result ??= Promise.resolve({ blob: new Blob(['fixture'], {type:'video/mp4'}), durationSeconds: 1, frameCount: 25, width:1920, height:1080, fps:25 });
          },
          cancel() { window.canceledCaptures++; options.setRecordingActive?.(false); }
        };
      }
    `,
    }),
  );
}
const fixture = '/clipToTrack/tests/fixtures/map-capture.html';
const preview = (page: Page) =>
  page.getByRole('dialog', { name: 'Preview map recording' });

for (const width of [1280, 412]) {
  test(`preview requires explicit download approval at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockRecorder(page);
    await page.goto(fixture);
    let downloads = 0;
    page.on('download', () => downloads++);
    const frame = await page.locator('.map-capture-frame').boundingBox();
    expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 2);
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Stop & preview', exact: true })
      .click();
    await expect(preview(page)).toBeVisible();
    expect(downloads).toBe(0);
    await expect(preview(page)).toContainText('1920 × 1080 · 25 fps');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download MP4' }).click();
    expect((await download).suggestedFilename()).toBe(
      'ride--clip-map-1920x1080-25fps.mp4',
    );
    expect(downloads).toBe(1);
    const previousUrl = await page.locator('dialog video').getAttribute('src');
    await page.getByRole('button', { name: 'Record again' }).click();
    await expect(preview(page)).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { revokedCaptureUrls: string[] })
            .revokedCaptureUrls,
      ),
    ).toContain(previousUrl);
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Stop & preview', exact: true })
      .click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.locator('.map-capture')).toHaveCount(0);
    expect(downloads).toBe(1);
  });
}

test('beginning is the default and recording can start from a paused clip', async ({
  page,
}) => {
  await mockRecorder(page);
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Toggle source playback' }).click();
  await expect(
    page.getByRole('radio', { name: 'From beginning', exact: true }),
  ).toBeChecked();
  await page
    .getByRole('radio', { name: 'From current position', exact: true })
    .check();
  await expect(
    page.getByRole('button', { name: 'Start recording' }),
  ).toBeDisabled();
  await page
    .getByRole('radio', { name: 'From beginning', exact: true })
    .check();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(
    page.getByRole('button', { name: 'Stop & preview' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { capturePreparedPosition: string })
          .capturePreparedPosition,
    ),
  ).toBe('beginning');
  expect(
    await page.evaluate(
      () => (window as unknown as { captureResumed: boolean }).captureResumed,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { captureResumedAfterReady: boolean })
          .captureResumedAfterReady,
    ),
  ).toBe(true);
});

test('current-position recording preserves the selected mode', async ({
  page,
}) => {
  await mockRecorder(page);
  await page.goto(fixture);
  await page
    .getByRole('radio', { name: 'From current position', exact: true })
    .check();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(
    page.getByRole('button', { name: 'Stop & preview' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { capturePreparedPosition: string })
          .capturePreparedPosition,
    ),
  ).toBe('current');
});

test('unsupported encoding disables Start with an explanation', async ({
  page,
}) => {
  await mockRecorder(page, false);
  await page.goto(fixture);
  await expect(
    page.getByRole('button', { name: 'Start recording' }),
  ).toBeDisabled();
  await expect(page.locator('.map-capture-message')).toContainText(
    'cannot encode H.264',
  );
});

for (const action of ['pause', 'switch', 'resize', 'hidden'] as const) {
  test(`automatically previews when the source changes: ${action}`, async ({
    page,
  }) => {
    await mockRecorder(page);
    await page.goto(fixture);
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(
      page.getByRole('button', { name: 'Stop & preview' }),
    ).toBeVisible();
    if (action === 'pause')
      await page
        .getByRole('button', { name: 'Toggle source playback' })
        .click();
    if (action === 'switch')
      await page.getByRole('button', { name: 'Switch source clip' }).click();
    if (action === 'resize')
      await page.setViewportSize({ width: 900, height: 800 });
    if (action === 'hidden')
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    await expect(preview(page)).toBeVisible();
  });
}

test('unmount cancels recording and Escape discards a preview', async ({
  page,
}) => {
  await mockRecorder(page);
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(
    page.getByRole('button', { name: 'Stop & preview' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove capture' }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { canceledCaptures: number }).canceledCaptures,
    ),
  ).toBe(1);
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Stop & preview' }).click();
  await expect(preview(page)).toBeVisible();
  const previousUrl = await page.locator('dialog video').getAttribute('src');
  await page.keyboard.press('Escape');
  await expect(page.locator('.map-capture')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { revokedCaptureUrls: string[] })
          .revokedCaptureUrls,
    ),
  ).toContain(previousUrl);
});

test('discard during asynchronous startup cancels the late recorder', async ({
  page,
}) => {
  await mockRecorder(page, true, 150);
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Remove capture' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { canceledCaptures: number }).canceledCaptures,
      ),
    )
    .toBe(1);
  await expect(page.locator('.map-capture')).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test(`actual map tools expose capture (${mobile ? 'compact' : 'desktop'})`, async ({
    page,
  }) => {
    await mockRecorder(page, false);
    // Map-tool access should not depend on third-party tile servers in CI.
    await page.route(
      /^https:\/\/(?:server\.arcgisonline\.com|tile\.openstreetmap\.org|[abc]\.tile\.opentopomap\.org)\//,
      (route) =>
        route.fulfill({
          contentType: 'image/png',
          headers: { 'access-control-allow-origin': '*' },
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64',
          ),
        }),
    );
    if (mobile) {
      await page.setViewportSize({ width: 412, height: 915 });
      await page.addInitScript(() =>
        localStorage.setItem('clip-to-track:force-layout', 'mobile'),
      );
    }
    await page.goto('/clipToTrack/');
    if (mobile)
      await page
        .getByRole('button', { name: 'Map options', exact: true })
        .click();
    await page
      .getByRole('button', { name: 'Record map · 25 fps', exact: true })
      .click();
    await expect(page.locator('.map-capture-frame')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Start recording' }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.map-capture')).toHaveCount(0);
  });
}

test('real encoder creates a playable constant-25-fps MP4 when supported', async ({
  page,
}) => {
  await page.goto('/clipToTrack/');
  const support = await page.evaluate(async () => {
    // Vite serves the real module; this test does not install the UI mock.
    const path = '/clipToTrack/src/lib/mapCapture/mapVideoRecorder.ts';
    const module = await import(/* @vite-ignore */ path);
    return module.checkMapCaptureSupport();
  });
  test.skip(!support.supported, support.reason);
  const result = await page.evaluate(async () => {
    const path = '/clipToTrack/src/lib/mapCapture/mapVideoRecorder.ts';
    const module = await import(/* @vite-ignore */ path);
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d')!;
    let render: (() => void) | undefined;
    let position = 0;
    const recorder = await module.createMapVideoRecorder({
      canvas,
      crop: { x: 0, y: 0, width: 1920, height: 1080 },
      subscribeRender: (callback: () => void) => {
        render = callback;
        return () => {
          render = undefined;
        };
      },
      requestRender: () => {
        ctx.fillStyle = '#336655';
        ctx.fillRect(0, 0, 1920, 1080);
        ctx.fillStyle = '#fff';
        ctx.fillRect(position++ * 4, 200, 50, 50);
        render?.();
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const recording = await recorder.stop();
    const m = await module.loadMapVideoMuxer();
    const input = new m.Input({
      source: new m.BlobSource(recording.blob),
      formats: [m.MP4],
    });
    const track = await input.getPrimaryVideoTrack();
    const rate = await track.computeFrameRateMetrics();
    const audio = (await input.getAudioTracks()).length;
    const video = document.createElement('video');
    video.muted = true;
    const url = URL.createObjectURL(recording.blob);
    video.src = url;
    document.body.append(video);
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('MP4 failed to decode'));
    });
    await video.play();
    await new Promise((resolve) => {
      video.onended = resolve;
    });
    const pixels = document.createElement('canvas');
    pixels.width = 1920;
    pixels.height = 1080;
    const pixelContext = pixels.getContext('2d')!;
    pixelContext.drawImage(video, 0, 0);
    const bottomPixel = Array.from(
      pixelContext.getImageData(1850, 1060, 1, 1).data,
    );
    const result = {
      bottomPixel,
      width: video.videoWidth,
      height: video.videoHeight,
      ended: video.ended,
      audio,
      rate,
      frames: recording.frameCount,
      duration: recording.durationSeconds,
      containerDuration: await input.computeDuration(),
    };
    URL.revokeObjectURL(url);
    input.dispose();
    return result;
  });
  expect(result).toMatchObject({
    width: 1920,
    height: 1080,
    ended: true,
    audio: 0,
    rate: { averageFrameRate: 25, frameRateIsConstant: true },
  });
  expect(result.bottomPixel[0]).toBeLessThan(80);
  expect(result.bottomPixel[1]).toBeGreaterThan(80);
  expect(result.bottomPixel[1]).toBeLessThan(125);
  expect(result.bottomPixel[3]).toBe(255);
  expect(result.duration).toBe(result.frames / 25);
  expect(result.containerDuration).toBeCloseTo(result.duration, 5);
});
