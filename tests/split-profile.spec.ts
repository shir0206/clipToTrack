import { expect, test } from '@playwright/test';

test('split panes keep their own view and recording controls below shared navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    '/clipToTrack/tests/fixtures/speedometer-capture.html?profile=1',
  );
  await page
    .locator('.profile-tab')
    .filter({ hasText: 'Speed' })
    .dragTo(page.locator('.profile-tab').filter({ hasText: 'Altitude' }));
  const altitude = page.getByRole('region', { name: 'Altitude pane' });
  const speed = page.getByRole('region', { name: 'Speed pane' });
  await expect(altitude).toBeVisible();
  await expect(speed).toBeVisible();
  await speed.getByRole('button', { name: 'Speedometer', exact: true }).click();
  await altitude.getByRole('button', { name: 'Values', exact: true }).click();
  await expect(
    speed.getByRole('button', { name: 'Speedometer', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    altitude.getByRole('button', { name: 'Values', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  for (const pane of [altitude, speed]) {
    await expect(pane.locator('.profile-record-actions button')).toHaveCount(1);
    await expect(
      pane.getByRole('button', { name: /Open .* in a new window/ }),
    ).toBeVisible();
    const toolbar = (await pane
      .locator('.profile-pane-toolbar')
      .boundingBox())!;
    const header = (await page.locator('.profile-header').boundingBox())!;
    expect(toolbar.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    const bounds = (await pane.boundingBox())!;
    expect(toolbar.x).toBeGreaterThanOrEqual(bounds.x);
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(
      bounds.x + bounds.width,
    );
  }
  await expect(page.locator('.profile-header .profile-view')).toHaveCount(0);
  const name = (await page
    .locator('.profile-header .profile-identity')
    .boundingBox())!;
  const exit = (await page
    .getByRole('button', { name: 'Close profile', exact: true })
    .boundingBox())!;
  expect(
    Math.abs(name.y + name.height / 2 - exit.y - exit.height / 2),
  ).toBeLessThan(2);
  await page.screenshot({ path: test.info().outputPath('split-profile.png') });
  await page.getByRole('button', { name: 'Cancel side-by-side view' }).click();
  await expect(page.locator('.profile-split-pane')).toHaveCount(0);
  await expect(
    page.locator('.profile-header .profile-record-actions button'),
  ).toHaveCount(1);
});
