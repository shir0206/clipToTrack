import { expect, test } from '@playwright/test';

test('groups GoPro companion files and selects the LRV source', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'ClipToTrack' }),
  ).toBeVisible();

  await page.getByTestId('file-input').setInputFiles([
    {
      name: 'GX010753.MP4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('video'),
    },
    {
      name: 'GL010753.LRV',
      mimeType: 'video/mp4',
      buffer: Buffer.from('proxy'),
    },
    {
      name: 'GX010753.THM',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('thumb'),
    },
    {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('ignore'),
    },
  ]);

  const clip = page.getByTestId('clip-card');
  await expect(clip).toHaveCount(1);
  await expect(clip).toContainText('GL010753.LRV');
  await expect(clip).toContainText('3 files');
  await expect(page.getByText('1 unrelated file ignored')).toBeVisible();
});

test('keeps MP4-only clips usable without directory APIs', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined });
  });
  await page.goto('/');

  await page.getByTestId('file-input').setInputFiles({
    name: 'GH010123.MP4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('video'),
  });

  await expect(page.getByTestId('clip-card')).toContainText('GH010123.MP4');
  await expect(page.getByTestId('clip-card')).toContainText(
    'No LRV proxy found',
  );
  await expect(
    page.getByRole('button', { name: 'Choose folder' }),
  ).toBeVisible();
});
