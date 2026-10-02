import { expect, it } from 'vitest';
import {
  collectDirectory,
  collectDrop,
  detectCapabilities,
  type DirectoryHandle,
  type DropEntry,
} from './imports';
const file = new File(['video'], 'GX010753.MP4');
it('detects fallbacks without requiring directory APIs', () => {
  expect(detectCapabilities({}, {})).toEqual({
    directoryPicker: false,
    directoryInput: false,
    saveFilePicker: false,
  });
  expect(
    detectCapabilities(
      { showDirectoryPicker: () => {}, showSaveFilePicker: () => {} },
      { webkitdirectory: false },
    ),
  ).toEqual({
    directoryPicker: true,
    directoryInput: true,
    saveFilePicker: true,
  });
});
it('recursively collects handles and preserves paths', async () => {
  const nested: DirectoryHandle = {
    kind: 'directory',
    name: '100GOPRO',
    async *values() {
      yield {
        kind: 'file' as const,
        name: file.name,
        getFile: async () => file,
      };
    },
  };
  const root: DirectoryHandle = {
    kind: 'directory',
    name: 'DCIM',
    async *values() {
      yield nested;
    },
  };
  expect((await collectDirectory(root)).files.map((x) => x.path)).toEqual([
    'DCIM/100GOPRO/GX010753.MP4',
  ]);
});
it('keeps accessible files when another entry is unreadable', async () => {
  const root: DirectoryHandle = {
    kind: 'directory',
    name: 'DCIM',
    async *values() {
      yield {
        kind: 'file' as const,
        name: 'bad.MP4',
        getFile: async () => {
          throw new Error('denied');
        },
      };
      yield {
        kind: 'file' as const,
        name: file.name,
        getFile: async () => file,
      };
    },
  };
  const result = await collectDirectory(root);
  expect(result.files).toHaveLength(1);
  expect(result.warnings[0]).toContain('bad.MP4');
});
it('reads every directory-drop batch, including batches after the first 100', async () => {
  const child: DropEntry = {
    name: file.name,
    isFile: true,
    isDirectory: false,
    file: (ok) => ok(file),
  };
  let call = 0;
  const entry: DropEntry = {
    name: 'DCIM',
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (ok) =>
        ok(
          call++ === 0
            ? Array.from({ length: 100 }, () => child)
            : call === 2
              ? [child]
              : [],
        ),
    }),
  };
  const transfer = {
    items: [
      { kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null },
    ],
    files: [],
  } as unknown as DataTransfer;
  expect((await collectDrop(transfer)).files).toHaveLength(101);
});
it('falls back to ordinary files when entry APIs are absent', async () => {
  const transfer = {
    items: [{ kind: 'file', getAsFile: () => file }],
    files: [file],
  } as unknown as DataTransfer;
  expect((await collectDrop(transfer)).files[0].file).toBe(file);
});
