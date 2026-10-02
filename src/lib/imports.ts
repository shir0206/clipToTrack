import type { SourceFile } from './discovery';

export interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

export interface DirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
}

export interface DropEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (
    ok: (file: File) => void,
    fail: (error: DOMException) => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      ok: (entries: DropEntry[]) => void,
      fail: (error: DOMException) => void,
    ) => void;
  };
}

export interface ImportResult {
  files: SourceFile[];
  warnings: string[];
}

export function detectCapabilities(windowLike: object, inputLike: object) {
  return {
    directoryPicker: 'showDirectoryPicker' in windowLike,
    directoryInput: 'webkitdirectory' in inputLike,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown error';
}

async function walkHandle(
  handle: DirectoryHandle,
  parts: string[],
  result: ImportResult,
): Promise<void> {
  for await (const entry of handle.values()) {
    const entryParts = [...parts, entry.name];
    const path = entryParts.join('/');

    if (entry.kind === 'directory') {
      await walkHandle(entry, entryParts, result);
      continue;
    }

    try {
      result.files.push({ file: await entry.getFile(), path });
    } catch (error) {
      result.warnings.push(`Could not read ${path}: ${errorMessage(error)}`);
    }
  }
}

export async function collectDirectory(
  handle: DirectoryHandle,
): Promise<ImportResult> {
  const result: ImportResult = { files: [], warnings: [] };
  await walkHandle(handle, [handle.name], result);
  return result;
}

function readEntryFile(entry: DropEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error('File entry is unavailable'));
      return;
    }
    entry.file(resolve, reject);
  });
}

function readBatch(reader: ReturnType<NonNullable<DropEntry['createReader']>>) {
  return new Promise<DropEntry[]>((resolve, reject) =>
    reader.readEntries(resolve, reject),
  );
}

async function walkDropEntry(
  entry: DropEntry,
  parents: string[],
  result: ImportResult,
): Promise<void> {
  const parts = [...parents, entry.name];
  const path = parts.join('/');

  if (entry.isFile) {
    try {
      result.files.push({ file: await readEntryFile(entry), path });
    } catch (error) {
      result.warnings.push(`Could not read ${path}: ${errorMessage(error)}`);
    }
    return;
  }

  if (!entry.isDirectory || !entry.createReader) return;

  const reader = entry.createReader();
  try {
    while (true) {
      const batch = await readBatch(reader);
      if (batch.length === 0) break;
      for (const child of batch) await walkDropEntry(child, parts, result);
    }
  } catch (error) {
    result.warnings.push(`Could not read ${path}: ${errorMessage(error)}`);
  }
}

type EntryItem = {
  kind: string;
  webkitGetAsEntry?: () => DropEntry | null;
  getAsFile: () => File | null;
};

export async function collectDrop(
  transfer: DataTransfer,
): Promise<ImportResult> {
  const result: ImportResult = { files: [], warnings: [] };
  const items = Array.from(transfer.items ?? []) as unknown as EntryItem[];
  const entries = items
    .filter((item) => item.kind === 'file' && item.webkitGetAsEntry)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is DropEntry => Boolean(entry));

  if (entries.length > 0) {
    for (const entry of entries) await walkDropEntry(entry, [], result);
    return result;
  }

  const transferFiles = Array.from(transfer.files ?? []);
  const fallbackFiles = transferFiles.length
    ? transferFiles
    : items
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

  result.files = fallbackFiles.map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
  return result;
}
