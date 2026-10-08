import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', 'src', 'index.html'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

const cssFiles = files.filter((file) => file.endsWith('.css'));
const sourceFiles = files.filter((file) => /\.(css|tsx?|html)$/.test(file));
const failures = [];

const report = (file, line, message) =>
  failures.push(`${file}:${line}: ${message}`);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/!important/g)) {
    report(file, lineOf(text, match.index), 'contains !important');
  }
  for (const match of text.matchAll(
    /class(?:Name)?=(?:"[^"]*\bctt-[^"]*"|{`[^`]*\bctt-[^`]*`})/g,
  )) {
    report(file, lineOf(text, match.index), 'contains old ctt-* class token');
  }
}

for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(^|})\s*([^{}]+)\{/gms)) {
    const selector = match[2];
    for (const id of selector.matchAll(/#[A-Za-z][A-Za-z0-9_-]*/g)) {
      report(
        file,
        lineOf(text, match.index + id.index),
        `contains ID selector ${id[0]}`,
      );
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `CSS audit passed (${cssFiles.length} CSS files, ${sourceFiles.length} source files).`,
);
