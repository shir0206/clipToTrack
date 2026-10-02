export interface SourceFile {
  file: File;
  path: string;
}

export interface Clip {
  id: string;
  name: string;
  directory: string;
  files: SourceFile[];
  telemetrySource: SourceFile | null;
  totalSize: number;
  warnings: string[];
}

type Role = 'MP4' | 'LRV' | 'THM';

interface ClassifiedFile {
  source: SourceFile;
  role: Role;
  groupId: string;
  displayName: string;
  directory: string;
  nonstandard: boolean;
}

const supportedRoles = new Set<Role>(['MP4', 'LRV', 'THM']);
const standardName = /^G[A-Z](\d{2})(\d{4})$/i;

function classify(source: SourceFile): ClassifiedFile | null {
  const path = source.path || source.file.name;
  const segments = path.split('/');
  const filename = segments.pop() || source.file.name;
  const directory = segments.join('/');
  const extensionIndex = filename.lastIndexOf('.');

  if (extensionIndex < 1) return null;

  const role = filename.slice(extensionIndex + 1).toUpperCase() as Role;
  if (!supportedRoles.has(role)) return null;

  const basename = filename.slice(0, extensionIndex);
  const match = standardName.exec(basename);
  const normalizedSource = { ...source, path };

  if (match) {
    const chapter = match[1];
    const recording = match[2];
    return {
      source: normalizedSource,
      role,
      groupId: `gopro:${directory}:${chapter}:${recording}`,
      displayName: `G${chapter}${recording}`,
      directory,
      nonstandard: false,
    };
  }

  return {
    source: normalizedSource,
    role,
    groupId: `renamed:${directory}:${basename.toLocaleLowerCase()}`,
    displayName: basename,
    directory,
    nonstandard: true,
  };
}

export function discoverClips(sources: SourceFile[]): {
  clips: Clip[];
  ignoredCount: number;
} {
  const groups = new Map<string, ClassifiedFile[]>();
  const identities = new Set<string>();
  let ignoredCount = 0;

  for (const source of sources) {
    const classified = classify(source);
    if (!classified) {
      ignoredCount += 1;
      continue;
    }

    const { file } = classified.source;
    const identity = [
      classified.source.path,
      file.name,
      file.size,
      file.lastModified,
    ].join('\0');
    if (identities.has(identity)) continue;
    identities.add(identity);

    const files = groups.get(classified.groupId) ?? [];
    files.push(classified);
    groups.set(classified.groupId, files);
  }

  const roleOrder: Record<Role, number> = { MP4: 0, LRV: 1, THM: 2 };
  const clips = [...groups.entries()].map(([id, candidates]): Clip => {
    candidates.sort(
      (left, right) =>
        roleOrder[left.role] - roleOrder[right.role] ||
        left.source.file.name.localeCompare(right.source.file.name),
    );

    const byRole = (role: Role) =>
      candidates.filter((candidate) => candidate.role === role);
    const mp4 = byRole('MP4');
    const lrv = byRole('LRV');
    const warnings: string[] = [];

    if (candidates.some((candidate) => candidate.nonstandard)) {
      warnings.push('Nonstandard GoPro name; files were grouped by basename.');
    }

    for (const role of ['MP4', 'LRV', 'THM'] as const) {
      if (byRole(role).length > 1) {
        warnings.push(
          `Multiple ${role} files found; review the duplicate candidates.`,
        );
      }
    }

    const usableLrv = lrv.find((candidate) => candidate.source.file.size > 0);
    if (lrv.some((candidate) => candidate.source.file.size === 0)) {
      warnings.push(
        'An LRV file is empty; another video source will be used when available.',
      );
    }

    if (mp4.length > 0 && lrv.length === 0) {
      warnings.push(
        'No LRV proxy found; the MP4 will be used as the telemetry source.',
      );
    }
    if (mp4.length === 0 && lrv.length > 0) {
      warnings.push('No MP4 source found; the LRV proxy will be used.');
    }
    if (mp4.length === 0 && lrv.length === 0) {
      warnings.push('No video file found for this thumbnail.');
    }

    const telemetryCandidate = usableLrv ?? mp4[0] ?? lrv[0] ?? null;
    const files = candidates.map((candidate) => candidate.source);

    return {
      id,
      name: candidates[0].displayName,
      directory: candidates[0].directory,
      files,
      telemetrySource: telemetryCandidate?.source ?? null,
      totalSize: files.reduce((total, source) => total + source.file.size, 0),
      warnings,
    };
  });

  clips.sort(
    (left, right) =>
      left.directory.localeCompare(right.directory) ||
      left.name.localeCompare(right.name),
  );

  return { clips, ignoredCount };
}
