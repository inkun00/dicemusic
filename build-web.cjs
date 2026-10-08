// Publish only the files required by the static app, plus its offline download.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname);
const destination = path.join(root, 'dist');
const offlineFile = '주사위작곡.html';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function localReferences(source, pattern) {
  return [...source.matchAll(pattern)].map(match => match[1])
    .filter(value => !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value));
}

function safeRelative(file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`File must stay inside the project: ${file}`);
  }
  return relative;
}

const html = read('index.html');
const files = new Set([
  'index.html',
  offlineFile,
  'assets/treble-clef.svg',
  'vendor/bravura-LICENSE.txt',
  'vendor/jspdf-LICENSE.txt',
  ...localReferences(html, /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)
]);
for (const file of [...files]) {
  if (file.endsWith('.css')) {
    for (const reference of localReferences(read(file), /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) {
      files.add(path.posix.join(path.posix.dirname(file), reference));
    }
  }
}

// Regenerate the downloadable HTML from current source before copying it.
execFileSync(process.execPath, [path.join(root, 'build-standalone.cjs')], { stdio: 'inherit' });
for (const file of files) {
  if (!fs.statSync(path.join(root, safeRelative(file))).isFile()) {
    throw new Error(`Missing runtime file: ${file}`);
  }
}

// This fixed build directory is the only recursive deletion target.
if (path.dirname(destination) !== root || path.basename(destination) !== 'dist') {
  throw new Error('Refusing to clear a directory outside the project dist folder.');
}
fs.rmSync(destination, { recursive: true, force: true });
for (const file of files) {
  const relative = safeRelative(file);
  const output = path.join(destination, relative);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(path.join(root, relative), output);
}
console.log(`Static app: dist (${files.size} files, all local asset references verified)`);
