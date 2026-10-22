import { test, expect } from '@playwright/test';

for (const [metric, title, middleClass] of [
  ['speed', 'Speedometer', '.gauge-middle'],
  ['alt', 'Altimeter', '.altitude-middle'],
] as const) {
  test(`${title} export keeps the blue underline below the title`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        if (this.src.startsWith('data:image/svg+xml'))
          Object.assign(window, {
            lastExportSvg: decodeURIComponent(
              this.src.split(',').slice(1).join(','),
            ),
          });
        return decode.call(this);
      };
    });
    // Exercise the real rasterizer at a lit telemetry position without waiting for encoding.
    await page.route('**/src/lib/mapCapture/mapVideoRecorder.ts*', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `export async function checkMapCaptureSupport(){return {supported:true}};
        export async function createMapVideoRecorder(options){await options.renderFrame(1.5);return {ready:Promise.resolve(),cancel(){},stop:async()=>({blob:new Blob(['x']),durationSeconds:1})}}`,
      }),
    );
    await page.goto(
      `/clipToTrack/tests/fixtures/speedometer-capture.html?metric=${metric}`,
    );
    await page
      .getByRole('button', { name: `Record ${title}`, exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Start recording', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Pause recording', exact: true }),
    ).toBeVisible();
    const result = await page.evaluate(async (middleClass) => {
      const svg = (window as unknown as { lastExportSvg: string })
        .lastExportSvg;
      const root = document
        .querySelector('.telemetry-export .profile-pane')!
        .getBoundingClientRect();
      const title = document
        .querySelector('.telemetry-export .gauge-label')!
        .getBoundingClientRect();
      const middle = document
        .querySelector(`.telemetry-export ${middleClass}`)!
        .getBoundingClientRect();
      const x = Math.round(middle.x - root.x + middle.width / 2 - 80);
      const y = Math.round(title.y - root.y + title.height / 2);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixel = Array.from(context.getImageData(x, y, 1, 1).data);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const readout = doc.querySelector<HTMLElement>('.gauge-readout')!;
      return {
        pixel,
        underlineHeight: parseFloat(readout.style.borderBottomWidth),
        borderImage: readout.style.borderImageSource,
        legacyBorderImage: readout.style.getPropertyValue(
          '-webkit-border-image',
        ),
        background: readout.style.backgroundImage,
      };
    }, middleClass);
    expect(result.pixel[2] - result.pixel[0]).toBeLessThan(30);
    expect(result.underlineHeight).toBe(1);
    expect(result.borderImage).toContain('linear-gradient');
    expect(result.legacyBorderImage).toBe('');
  });
}
