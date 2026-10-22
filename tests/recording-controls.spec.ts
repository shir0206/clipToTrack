import { expect, test } from '@playwright/test';

for (const width of [1280, 412, 320]) {
  test(`lower recording controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/src/lib/mapCapture/mapVideoRecorder.ts*', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `export async function checkMapCaptureSupport() { return {supported:true}; }
      export async function createMapVideoRecorder() { return { ready: Promise.resolve(), cancel() {}, stop: async () => ({blob:new Blob(['test']), durationSeconds:1, width:1920,height:1080,fps:25,frameCount:25}) }; }`,
      }),
    );
    await page.goto(
      `/clipToTrack/tests/fixtures/speedometer-capture.html?long=1${width < 640 ? '&compact=1' : ''}`,
    );
    await page.getByRole('button', { name: 'Record Speedometer' }).click();
    const bar = page.locator('.telemetry-record-bar');
    await expect(bar).toBeVisible();
    const frame = await page.locator('.telemetry-capture-stage').boundingBox();
    const check = async () => {
      const bounds = (await bar.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(frame!.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        frame!.x + frame!.width + 1,
      );
      expect(bounds.height).toBeLessThanOrEqual(width === 320 ? 110 : 80);
      const start = await bar.locator('.map-capture-primary').boundingBox();
      const close = await bar.locator('.map-capture-dismiss').boundingBox();
      expect(start!.x).toBeGreaterThanOrEqual(bounds.x);
      expect(close!.x + close!.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1,
      );
    };
    await check();
    await page.screenshot({ path: test.info().outputPath('framing.png') });
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause recording', exact: true }),
    ).toBeVisible();
    await check();
    await page.screenshot({ path: test.info().outputPath('recording.png') });
  });
}
