import { expect, test, type Page } from '@playwright/test';

const appPath = '/clipToTrack/';

async function openMobile(page: Page) {
  await page.goto(appPath, { waitUntil: 'networkidle' });
  await expect(page.locator('.clip-card').first()).toBeVisible();
}

async function openEmptyMobile(page: Page) {
  await page.goto(appPath, { waitUntil: 'networkidle' });
  await expect(page.locator('.upload-zone').first()).toBeVisible();
}

async function touchDrag(page: Page, x: number, y1: number, y2: number) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: y1, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  });
  for (let i = 1; i <= 8; i += 1) {
    const y = y1 + ((y2 - y1) * i) / 8;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
    });
    await page.waitForTimeout(20);
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test.describe('mobile QA regressions', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('portrait sheet scrolls with touch and map controls stay usable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile'),
    );
    await openMobile(page);

    await expect
      .poll(() => page.locator('.app-layout').evaluate((el) => el.scrollTop))
      .toBe(0);

    const initialTopControls = page.locator(
      '.maplibregl-ctrl-top-right button',
    );
    for (let i = 0; i < (await initialTopControls.count()); i += 1) {
      const box = await initialTopControls.nth(i).boundingBox();
      expect(box, `initial map control ${i} should be visible`).toBeTruthy();
      expect(box!.y, `initial map control ${i} top`).toBeGreaterThanOrEqual(0);
    }

    const before = await page.locator('.sheet-body').evaluate((el) => ({
      top: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
    }));
    expect(before.max).toBeGreaterThan(250);

    await touchDrag(page, 200, 760, 420);
    await page.waitForTimeout(500);

    await expect
      .poll(() => page.locator('.sheet-body').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before.top + 80);

    const mapButtons = page.locator(
      '.maplibregl-ctrl-top-right button, .maplibregl-ctrl-bottom-right button, .maplibregl-ctrl-bottom-left button',
    );
    const count = await mapButtons.count();
    for (let i = 0; i < count; i += 1) {
      const box = await mapButtons.nth(i).boundingBox();
      expect(box, `map control ${i} should be visible`).toBeTruthy();
      expect(box!.width, `map control ${i} width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `map control ${i} height`).toBeGreaterThanOrEqual(44);
      expect(box!.y, `map control ${i} top`).toBeGreaterThanOrEqual(0);
    }

    const coordinates = page.locator('.map-coordinates');
    await expect(coordinates).toBeVisible();
    const coordBox = await coordinates.boundingBox();
    expect(coordBox!.height).toBeGreaterThanOrEqual(44);

    const credits = page.locator('.map-credit-button');
    const scale = page.locator('.maplibregl-ctrl-scale');
    await expect(credits).toHaveCount(1);
    await expect(credits.first()).toHaveText(
      '© Shir Zabolotny | © OpenStreetMap',
    );
    await expect(scale).toBeVisible();

    const creditBox = await credits.first().boundingBox();
    const scaleBox = await scale.boundingBox();
    expect(creditBox).toBeTruthy();
    expect(scaleBox).toBeTruthy();
    const rowCenters = [
      creditBox!.y + creditBox!.height / 2,
      coordBox!.y + coordBox!.height / 2,
      scaleBox!.y + scaleBox!.height / 2,
    ];
    expect(Math.max(...rowCenters) - Math.min(...rowCenters)).toBeLessThan(3);

    const chipStyles = await Promise.all(
      [credits.first(), coordinates, scale].map((locator) =>
        locator.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
            color: style.color,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            opacity: style.opacity,
          };
        }),
      ),
    );
    expect(new Set(chipStyles.map((style) => JSON.stringify(style))).size).toBe(
      1,
    );
    await expect
      .poll(() =>
        coordinates.evaluate((el) => getComputedStyle(el).flexGrow),
      )
      .toBe('0');
    const scaleDetails = await scale.evaluate((el) => {
      const rulerStyle = getComputedStyle(el, '::after');
      return {
        borderBottomWidth: rulerStyle.borderBottomWidth,
        borderLeftWidth: rulerStyle.borderLeftWidth,
        borderRightWidth: rulerStyle.borderRightWidth,
        inlineWidth: (el as HTMLElement).style.width,
        outerWidth: el.getBoundingClientRect().width,
        rulerWidth: rulerStyle.width,
      };
    });
    expect(scaleDetails.inlineWidth).toMatch(/px$/);
    expect(parseFloat(scaleDetails.rulerWidth)).toBeCloseTo(
      parseFloat(scaleDetails.inlineWidth),
      0,
    );
    expect(
      scaleDetails.outerWidth - parseFloat(scaleDetails.rulerWidth),
    ).toBeGreaterThanOrEqual(31.5);
    expect(scaleDetails.borderBottomWidth).toBe('2px');
    expect(scaleDetails.borderLeftWidth).toBe('2px');
    expect(scaleDetails.borderRightWidth).toBe('2px');
  });

  test('landscape uses compact clip cards and touch-sized map controls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile-landscape'),
    );
    await openMobile(page);

    const panel = await page.locator('.sheet-body').boundingBox();
    const card = await page.locator('.clip-card').first().boundingBox();
    expect(panel).toBeTruthy();
    expect(card).toBeTruthy();
    expect(card!.height).toBeLessThanOrEqual(panel!.height);

    const mapButtons = page.locator(
      '.maplibregl-ctrl-top-right button, .maplibregl-ctrl-bottom-right button, .maplibregl-ctrl-bottom-left button',
    );
    const count = await mapButtons.count();
    for (let i = 0; i < count; i += 1) {
      const box = await mapButtons.nth(i).boundingBox();
      expect(box, `landscape map control ${i} should be visible`).toBeTruthy();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('mobile settings expose map toolbar options in a collapsed section', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile'),
    );
    await openMobile(page);

    await page.getByRole('button', { name: 'Settings' }).click();
    const toolbarSection = page.getByRole('group', {
      name: 'View and map toolbars',
    });
    await expect(toolbarSection).toBeVisible();
    await expect(page.getByText('Place search')).toBeHidden();

    await toolbarSection.getByText('View and map toolbars').click();
    await expect(page.getByText('Place search')).toBeVisible();
  });

  test('empty project sheet wraps upload content instead of filling half the screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem('clip-to-track:force-layout', 'mobile');
      localStorage.setItem('clip-to-track:example', '{"enabled":false}');
      localStorage.setItem('clip-to-track:clips:v1', '[]');
      localStorage.setItem('clip-to-track:projects:v1', '[]');
    });
    await openEmptyMobile(page);

    await page.locator('.mobile-project').click();
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.getByText('This project is empty')).toBeVisible();

    const metrics = await page.evaluate(() => {
      const sheet = document.querySelector('.side-panel')!;
      const upload = document.querySelector('.upload-zone')!;
      const sheetRect = sheet.getBoundingClientRect();
      const uploadRect = upload.getBoundingClientRect();
      return {
        visibleHeight: window.innerHeight - sheetRect.top,
        blankAfterUpload: window.innerHeight - uploadRect.bottom,
      };
    });

    expect(metrics.visibleHeight).toBeLessThanOrEqual(320);
    expect(metrics.blankAfterUpload).toBeLessThanOrEqual(72);
  });
});
