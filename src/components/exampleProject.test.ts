import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('loadExampleClips', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
    vi.stubGlobal('window', {});
  });

  it('uses the metadata source filename when checking bundled video assets', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | RequestInfo) => {
        requestedUrls.push(String(url));
        return {
          ok: true,
          headers: {
            get: () =>
              String(url).endsWith('.jpg') ? 'image/jpeg' : 'video/mp4',
          },
        };
      }),
    );

    const { loadExampleClips } = await import('./exampleProject');

    const { clips, missing } = await loadExampleClips();

    expect(missing).toEqual([]);
    expect(requestedUrls.some((url) => url.endsWith('/GX010753.MP4'))).toBe(
      true,
    );
    expect(requestedUrls.some((url) => url.endsWith('/GX010753.mp4'))).toBe(
      false,
    );
    expect(clips[0].videoUrl).toMatch(/\.MP4$/);
  });
});
