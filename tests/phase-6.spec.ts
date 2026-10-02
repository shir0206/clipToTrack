import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('exports GPX from the reference LRV without a save picker', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles(resolve('asset', 'GL010753.LRV'));

  const panel = page.getByTestId('export-panel');
  await expect(panel).toContainText('65 GPS points ready', { timeout: 30_000 });
  await expect(panel.getByRole('radio', { name: 'Raw' })).toBeChecked();

  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'GPX' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('G010753.gpx');
});
