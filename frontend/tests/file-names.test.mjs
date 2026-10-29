// Windows and macOS ignore case in file names; Linux does not. Two source
// files whose names differ only in case (transcript.ts beside
// Transcript.tsx), or an import whose case differs from its file, build on
// Linux and break the build on Windows. These checks keep both out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const codeExt = /\.(tsx|ts|jsx|js|mjs)$/;

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** Whether path exists with exactly this case, checked one part at a time. */
function existsExactly(target) {
  const parts = path.relative(path.parse(target).root, target).split(path.sep);
  let dir = path.parse(target).root;
  for (const part of parts) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return false;
    }
    if (!names.includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}

function existsIgnoringCase(target) {
  try {
    const names = fs.readdirSync(path.dirname(target)).map(n => n.toLowerCase());
    return names.includes(path.basename(target).toLowerCase());
  } catch {
    return false;
  }
}

const files = walk(src);

test('no two source files differ only in case', () => {
  const seen = new Map();
  const clashes = [];
  for (const file of files) {
    const stem = path.relative(src, file).replace(codeExt, '');
    const key = stem.toLowerCase();
    if (seen.has(key) && seen.get(key) !== stem) clashes.push(`${seen.get(key)} and ${stem}`);
    else seen.set(key, stem);
  }
  assert.deepEqual(clashes, []);
});

test('relative imports name their files with the right case', () => {
  const candidates = spec => ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'].map(ext => spec + ext);
  const wrong = [];
  for (const file of files.filter(f => codeExt.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const spec = path.resolve(path.dirname(file), match[1]);
      const options = candidates(spec);
      const exact = options.find(p => existsExactly(p) && fs.statSync(p).isFile());
      if (!exact && options.some(existsIgnoringCase)) wrong.push(`${path.relative(src, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(wrong, []);
});
