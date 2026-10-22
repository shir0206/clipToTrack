import { expect, test } from '@playwright/test';

const targets = [
  ['alt', 'graph', 'Altitude Graph', 'altitude graph'],
  ['alt', 'dial', 'Altimeter', 'altimeter'],
  ['alt', 'readout', 'Altitude Values', 'altitude values'],
  ['speed', 'graph', 'Speed Graph', 'speed graph'],
  ['speed', 'dial', 'Speedometer', 'speedometer'],
  ['speed', 'readout', 'Speed Values', 'speed values'],
] as const;
for (const [metric, mode, title, label] of targets) {
  test(`records ${title} through the shared pipeline`, async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium');
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
      `/clipToTrack/tests/fixtures/speedometer-capture.html?metric=${metric}&mode=${mode}${metric === 'alt' ? '&altitudeOnly=1' : ''}`,
    );
    await page
      .getByRole('button', { name: `Record ${title}`, exact: true })
      .click();
    await expect(
      page.getByText(`Frame your ${label}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('From beginning')).toBeVisible();
    await expect(page.getByLabel('From current position')).toBeVisible();
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: `Preview ${label} recording`,
    });
    await expect(dialog).toBeVisible({ timeout: 60000 });
    await expect(dialog.locator('video')).toBeVisible({ timeout: 60000 });
    await expect(dialog).toContainText('2.00 seconds');
    expect(await page.locator('.telemetry-export button').count()).toBe(0);
    const result = await dialog.locator('video').evaluate(async (element) => {
      const video = element as HTMLVideoElement;
      if (video.readyState < 2)
        await new Promise<void>((resolve) => {
          video.onloadeddata = () => resolve();
        });
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const context = canvas.getContext('2d')!;
      const pixels = async (time: number) => {
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          video.currentTime = time;
        });
        context.drawImage(video, 0, 0);
        return context.getImageData(0, 0, 1920, 1080).data;
      };
      const first = await pixels(0.1);
      const last = await pixels(1.8);
      let changed = 0;
      let nonBlack = 0;
      for (let i = 0; i < first.length; i += 4) {
        if (
          Math.abs(first[i] - last[i]) > 20 ||
          Math.abs(first[i + 1] - last[i + 1]) > 20
        )
          changed++;
        if (first[i] > 30 || first[i + 1] > 30) nonBlack++;
      }
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        changed,
        nonBlack,
      };
    });
    expect(result).toMatchObject({ width: 1920, height: 1080 });
    expect(result.nonBlack).toBeGreaterThan(500);
    expect(result.changed).toBeGreaterThan(50);
    await page.screenshot({ path: test.info().outputPath('preview.png') });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download MP4' }).click();
    expect((await download).suggestedFilename()).toContain(
      `-${label.replaceAll(' ', '-')}-1920x1080-25fps.mp4`,
    );
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.locator('.map-capture')).toHaveCount(0);
    await expect(page.locator('.telemetry-export')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const [context, query, selector] of [
  [
    'mobile values',
    'metric=alt&mode=readout&compact=1&altitudeOnly=1',
    '.telemetry-readout-number',
  ],
  ['popup graph', 'metric=speed&mode=graph&popup=1', '.profile-pane'],
] as const) {
  test(`preserves ${context} styling in the export renderer`, async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium');
    test.setTimeout(90000);
    if (context === 'mobile values')
      await page.setViewportSize({ width: 412, height: 900 });
    await page.goto(
      `/clipToTrack/tests/fixtures/speedometer-capture.html?${query}&long=1`,
    );
    await page.getByRole('button', { name: /^Record / }).click();
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Pause recording', exact: true })
      .click();
    await expect(page.locator('dialog video')).toBeVisible({ timeout: 60000 });
    const styles = await page.evaluate((selector) => {
      const properties = (element: Element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: style.fontSize,
          paddingTop: style.paddingTop,
          paddingLeft: style.paddingLeft,
        };
      };
      return {
        live: properties(
          document.querySelector(`.telemetry-capture-stage ${selector}`)!,
        ),
        exported: properties(
          document.querySelector(`.telemetry-export ${selector}`)!,
        ),
      };
    }, selector);
    expect(styles.exported).toEqual(styles.live);
  });
}
