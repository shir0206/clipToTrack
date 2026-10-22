import { expect, test } from '@playwright/test';

test('exports a real dashboard-only MP4 with changing telemetry and black padding', async ({
  page,
}) => {
  test.skip(
    !test.info().project.name.includes('chromium'),
    'WebCodecs H.264 coverage runs in Chromium.',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/clipToTrack/tests/fixtures/speedometer-capture.html');
  await page.getByRole('button', { name: 'Record Speedometer' }).click();
  await expect(page.locator('.map-stage .map-capture-header')).toContainText(
    'Frame your speedometer',
  );
  await expect(page.getByText('Map stays visible')).toBeVisible();
  await expect(
    page.locator('.telemetry-capture-stage .map-capture-frame'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Start recording', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Preview speedometer recording',
  });
  await expect(dialog).toBeVisible({ timeout: 60000 });
  await expect(dialog.locator('video')).toBeVisible({ timeout: 60000 });
  await expect(dialog).toContainText('2.00 seconds');
  const pixels = await page
    .locator('dialog video')
    .evaluate(async (element) => {
      const video = element as HTMLVideoElement;
      if (video.readyState < 2)
        await new Promise<void>((resolve) => {
          video.onloadeddata = () => resolve();
        });
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const context = canvas.getContext('2d')!;
      const read = async (time: number) => {
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          video.currentTime = time;
        });
        context.drawImage(video, 0, 0);
        return {
          top: Array.from(context.getImageData(960, 20, 1, 1).data),
          data: Array.from(context.getImageData(750, 400, 420, 280).data),
        };
      };
      const a = await read(0.1);
      const b = await read(1.8);
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        padding: a.top,
        changed: a.data.some((value, i) => Math.abs(value - b.data[i]) > 30),
        litPixels: a.data.filter((v, i) => i % 4 !== 3 && v > 100).length,
      };
    });
  expect(pixels.width).toBe(1920);
  expect(pixels.height).toBe(1080);
  expect(pixels.padding.slice(0, 3).every((v) => v < 10)).toBe(true);
  expect(pixels.litPixels).toBeGreaterThan(100);
  expect(pixels.changed).toBe(true);
  await page.screenshot({ path: test.info().outputPath('preview.png') });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download MP4' }).click();
  expect((await download).suggestedFilename()).toBe(
    'Telemetry test-speedometer-1920x1080-25fps.mp4',
  );
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('.map-capture')).toHaveCount(0);
  await expect(page.locator('.telemetry-export')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('current-position uses media time, zoom changes only composition, and cancel cleans up', async ({
  page,
}) => {
  test.skip(!test.info().project.name.includes('chromium'));
  await page.goto('/clipToTrack/tests/fixtures/speedometer-capture.html');
  await page.getByRole('button', { name: 'Record Speedometer' }).click();
  const before = await page.locator('.gauge-cluster').boundingBox();
  await page.getByRole('slider', { name: 'Speedometer export zoom' }).fill('2');
  expect(await page.locator('.gauge-cluster').boundingBox()).toEqual(before);
  await page.getByRole('button', { name: 'Fit dashboard' }).click();
  await page.getByLabel('From current position').check();
  await page
    .getByRole('button', { name: 'Start recording', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Preview speedometer recording',
  });
  await expect(dialog).toBeVisible({ timeout: 60000 });
  await expect(dialog.locator('video')).toBeVisible({ timeout: 60000 });
  await expect(dialog).toContainText('1.00 seconds');
  await page.getByRole('button', { name: 'Record again' }).click();
  await page
    .getByRole('button', { name: 'Start recording', exact: true })
    .click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('.map-capture')).toHaveCount(0);
  await expect(page.locator('.telemetry-export')).toHaveCount(0);
});

for (const control of ['Pause clip', 'Pause recording']) {
  test(`Start begins live playback and ${control} finishes only the recorded interval`, async ({
    page,
  }) => {
    test.skip(!test.info().project.name.includes('chromium'));
    await page.goto(
      '/clipToTrack/tests/fixtures/speedometer-capture.html?long=1',
    );
    await page.getByRole('button', { name: 'Record Speedometer' }).click();
    await expect(page.getByLabel('From beginning')).toBeVisible();
    await expect(page.getByLabel('From current position')).toBeVisible();
    await expect(page.getByText('Clip paused', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .click();
    await expect(page.getByText('Clip playing', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: control, exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Preview speedometer recording',
    });
    await expect(dialog).toBeVisible({ timeout: 60000 });
    await expect(dialog.locator('video')).toBeVisible({ timeout: 60000 });
    const text = await dialog.textContent();
    const seconds = Number(text?.match(/([\d.]+) seconds/)?.[1]);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThan(10);
    const pausedAt = Number(
      await page.locator('output[aria-label="Playback time"]').textContent(),
    );
    expect(Math.abs(seconds - pausedAt)).toBeLessThan(0.05);
  });
}

test('telemetry-only recording pauses and restores normal dashboard probing after close', async ({
  page,
}) => {
  test.skip(!test.info().project.name.includes('chromium'));
  await page.goto(
    '/clipToTrack/tests/fixtures/speedometer-capture.html?virtual=1&long=1',
  );
  await page.getByRole('button', { name: 'Record Speedometer' }).click();
  await page
    .getByRole('button', { name: 'Start recording', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Pause recording', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Preview speedometer recording' }),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Jump probe' }).click();
  await expect(page.locator('.gauge-cluster')).toHaveAttribute(
    'aria-label',
    /Speedometer: 40 km/,
  );
});

test('opens the preview modal immediately with finalization progress, then shows the video', async ({
  page,
}) => {
  await page.route('**/src/lib/mapCapture/mapVideoRecorder.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
      export async function checkMapCaptureSupport() { return { supported: true }; }
      export async function createMapVideoRecorder(options) {
        let result;
        return {
          ready: Promise.resolve(),
          cancel() {},
          stop() {
            options.onStatus?.('finalizing');
            options.onFinalizationProgress?.(0);
            setTimeout(() => options.onFinalizationProgress?.(45), 250);
            return result ??= new Promise(resolve => setTimeout(() => resolve({ blob: new Blob(['fixture'], {type:'video/mp4'}), durationSeconds: 1, frameCount: 25, width:1920, height:1080, fps:25 }), 1500));
          }
        };
      }
    `,
    }),
  );
  await page.goto(
    '/clipToTrack/tests/fixtures/speedometer-capture.html?long=1',
  );
  await page.getByRole('button', { name: 'Record Speedometer' }).click();
  await page
    .getByRole('button', { name: 'Start recording', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Pause recording', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Preview speedometer recording',
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('Finalizing MP4', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '45',
  );
  await expect(dialog).toContainText('45%');
  await page.screenshot({ path: test.info().outputPath('finalizing.png') });
  await expect(dialog.locator('video')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Download MP4' }),
  ).toHaveCount(0);
  await expect(dialog.locator('video')).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Download MP4' }),
  ).toBeVisible();
});
