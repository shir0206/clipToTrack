import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const cssFiles = execFileSync('git', ['ls-files', 'src'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((file) => file.endsWith('.css'));

const classToFiles = new Map();
const failures = [];

for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  for (const [, name] of text.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) {
    if (name.startsWith('maplibregl-')) continue;
    if (
      name.startsWith('is-') ||
      name.startsWith('has-') ||
      name.startsWith('hides-')
    )
      continue;
    if (name.startsWith('ctt-')) failures.push(`${file}: old class ${name}`);
    if (name.includes('__') || name.includes('--'))
      failures.push(`${file}: BEM-style class ${name}`);
    const parts = name.split('-');
    if (parts.length > 2) failures.push(`${file}: long class ${name}`);
    const seen = classToFiles.get(name) ?? new Set();
    seen.add(file);
    classToFiles.set(name, seen);
  }
}

for (const [name, files] of classToFiles) {
  if (
    files.size > 1 &&
    ![
      'icon-button',
      'link-button',
      'inline-icon',
      'confirm-bar',
      'plain-list',
      'gauge-needle',
      'gauge-fill',
      'dial-label',
      'gauge-bar',
      'gauge-segment',
      'gauge-readout',
      'gauge-label',
      'gauge-tiles',
      'gauge-tile',
      'tile-icon',
      'tile-text',
    ].includes(name)
  ) {
    failures.push(
      `${name}: defined in multiple files (${[...files].join(', ')})`,
    );
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Collision check passed (${classToFiles.size} class names).`);
