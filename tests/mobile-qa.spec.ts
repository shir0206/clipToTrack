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

async function enableMeasureFromMapOptions(page: Page) {
  await page.getByRole('button', { name: 'Map options' }).click();
  await page
    .getByRole('dialog', { name: 'Map options' })
    .getByRole('switch', { name: 'Measure distance' })
    .click();
  await expect(page.locator('.measure-bar')).toBeVisible();
}

async function expectMeasureBarClearOfMapCredits(page: Page) {
  const overlaps = await page.evaluate(() => {
    const measure = document
      .querySelector('.measure-bar')!
      .getBoundingClientRect();
    return [
      '.map-coordinates',
      '.maplibregl-ctrl-scale',
      '.map-credit-button',
    ].map((selector) => {
      const target = document.querySelector(selector)!.getBoundingClientRect();
      return {
        selector,
        overlaps:
          measure.left < target.right &&
          measure.right > target.left &&
          measure.top < target.bottom &&
          measure.bottom > target.top,
      };
    });
  });

  expect(overlaps.filter(({ overlaps: hasOverlap }) => hasOverlap)).toEqual([]);
}

async function stubPlaceSearch(page: Page) {
  await page.route('https://nominatim.openstreetmap.org/search**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          place_id: 209952533,
          display_name: 'Haifa, Haifa Subdistrict, Haifa District, Israel',
          boundingbox: ['32.7579523', '32.8475328', '34.9486027', '35.0797444'],
        },
      ]),
    }),
  );
}

test.describe('mobile QA regressions', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('mobile place search result moves the map to the selected place', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile'),
    );
    await stubPlaceSearch(page);
    await openMobile(page);

    await page.locator('.search-box input').fill('haifa');
    await page.getByRole('option', { name: /Haifa/ }).click();

    await expect
      .poll(async () => {
        const text = await page.locator('.map-coordinates').textContent();
        return text ?? '';
      })
      .toContain('32.');
  });

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
      '.maplibregl-ctrl-top-right button:visible',
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
      '.maplibregl-ctrl-top-right button:visible, .maplibregl-ctrl-bottom-right button:visible, .maplibregl-ctrl-bottom-left button:visible',
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
      '© Shir Zabolotny 2026 · © OpenStreetMap',
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
    expect(coordBox!.x).toBeLessThan(scaleBox!.x);
    expect(scaleBox!.x).toBeLessThan(creditBox!.x);
    expect(scaleBox!.x).toBeGreaterThanOrEqual(coordBox!.x + coordBox!.width);
    expect(scaleBox!.x + scaleBox!.width).toBeLessThanOrEqual(creditBox!.x);
    const coordinateGap = scaleBox!.x - (coordBox!.x + coordBox!.width);
    const creditGap = creditBox!.x - (coordBox!.x + coordBox!.width);
    expect(coordinateGap).toBeLessThanOrEqual(12);
    expect(coordinateGap).toBeLessThan(creditGap);
    const heights = [creditBox!.height, coordBox!.height, scaleBox!.height];
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    await credits.first().click();
    await expect(page.locator('.map-credits-pop')).toHaveCount(0);

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
    expect(chipStyles[0].backgroundColor).toBe('rgb(255, 255, 255)');
    await expect
      .poll(() => coordinates.evaluate((el) => getComputedStyle(el).flexGrow))
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
    expect(parseFloat(scaleDetails.borderBottomWidth)).toBeGreaterThanOrEqual(
      1,
    );
    expect(parseFloat(scaleDetails.borderLeftWidth)).toBeGreaterThanOrEqual(1);
    expect(parseFloat(scaleDetails.borderRightWidth)).toBeGreaterThanOrEqual(1);
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
      '.maplibregl-ctrl-top-right button:visible, .maplibregl-ctrl-bottom-right button:visible, .maplibregl-ctrl-bottom-left button:visible',
    );
    const count = await mapButtons.count();
    for (let i = 0; i < count; i += 1) {
      const box = await mapButtons.nth(i).boundingBox();
      expect(box, `landscape map control ${i} should be visible`).toBeTruthy();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('measure mode launched from map options does not cover map credits', async ({
    browser,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile'),
    );
    await openMobile(page);

    await enableMeasureFromMapOptions(page);
    await expectMeasureBarClearOfMapCredits(page);

    const landscapeContext = await browser.newContext({
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      viewport: { width: 844, height: 390 },
    });
    const landscapePage = await landscapeContext.newPage();
    await landscapePage.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile-landscape'),
    );
    await openMobile(landscapePage);

    await enableMeasureFromMapOptions(landscapePage);
    await expectMeasureBarClearOfMapCredits(landscapePage);
    await landscapeContext.close();
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

  test('mobile speed and altitude clusters expose playback controls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile'),
    );
    await openMobile(page);

    await page
      .getByRole('button', { name: 'Telemetry: speed and altitude' })
      .click();
    await page.getByRole('button', { name: 'Altimeter' }).click();
    await expect(page.locator('.altitude-cluster')).toBeVisible();
    await expect(
      page.locator('.altitude-cluster .gauge-playback-button').first(),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Play .* altitude/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Stop .* altitude/i }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Speed', exact: true }).click();
    await page.getByRole('button', { name: 'Speedometer' }).click();
    await expect(
      page.locator('.gauge-cluster:not(.altitude-cluster)'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Play .* speed/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Stop .* speed/i }),
    ).toBeVisible();
  });

  test('map options sheet stays within the mobile viewport', async ({
    browser,
  }) => {
    for (const config of [
      { width: 390, height: 844, layout: 'mobile' },
      { width: 844, height: 390, layout: 'mobile-landscape' },
    ]) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
        viewport: { width: config.width, height: config.height },
      });
      const page = await context.newPage();
      await page.addInitScript((layout) => {
        localStorage.setItem('clip-to-track:force-layout', layout);
      }, config.layout);
      await openMobile(page);

      await page.getByRole('button', { name: 'Map options' }).click();
      const menuBox = await page
        .getByRole('dialog', { name: 'Map options' })
        .boundingBox();
      expect(menuBox).toBeTruthy();
      expect(menuBox!.y).toBeGreaterThanOrEqual(0);
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(config.height);

      await context.close();
    }
  });

  test('mobile clip video tap toggles playback without a maximize button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile'),
    );
    await openMobile(page);

    const card = page.locator('.clip-card').first();
    await expect(card.getByRole('button', { name: /Maximize/i })).toHaveCount(
      0,
    );

    const video = card.locator('video.video-frame');
    await expect(video).toBeVisible();

    await video.click();
    await expect(card.getByRole('button', { name: /Pause/i })).toBeVisible();

    await video.click();
    await expect(card.getByRole('button', { name: /Play/i })).toBeVisible();
  });

  test('terrain control is hidden by default and can be shown from settings', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem('clip-to-track:force-layout', 'mobile'),
    );
    await openMobile(page);

    const terrainControl = page.locator(
      '.maplibregl-ctrl-terrain, .maplibregl-ctrl-terrain-enabled',
    );
    await expect(terrainControl).toBeHidden();

    await page.getByRole('button', { name: 'Settings' }).click();
    const toolbarSection = page.getByRole('group', {
      name: 'View and map toolbars',
    });
    await toolbarSection.getByText('View and map toolbars').click();
    await page.getByRole('switch', { name: 'Terrain button' }).check();
    await page.getByRole('button', { name: 'Close settings' }).click();

    await expect(terrainControl).toBeVisible();
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
