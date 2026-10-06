import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

const root = process.cwd();
const map = JSON.parse(readFileSync('scripts/rename-map.json', 'utf8'));
const files = process.argv.slice(2);

if (!files.length) {
  console.error('usage: node scripts/rename-classes.mjs <files...>');
  process.exit(1);
}

const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const file of files) {
  let text = readFileSync(file, 'utf8');
  const before = text;
  for (const [from, to] of entries) {
    text = text.replace(
      new RegExp(`(?<![A-Za-z0-9_-])${escape(from)}(?![A-Za-z0-9_-])`, 'g'),
      to,
    );
  }
  if (text !== before) {
    writeFileSync(file, text);
    console.log(`renamed ${relative(root, file)}`);
  }
}
