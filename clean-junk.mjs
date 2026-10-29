// WordPress catch-all serves the homepage for any bogus URL, so earlier crawl
// runs saved homepage copies into junk-named dirs at every level. Delete any
// index.html (except the site root) whose content is identical to the homepage,
// then prune empty dirs.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const OUT = path.join(HERE, 'site');

const homeHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, 'index.html'))).digest('hex');
let removed = 0;
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fs.existsSync(full)) walk(full);
      continue;
    }
    if (!/^index\.html?$/i.test(entry.name)) continue;
    if (path.resolve(dir) === path.resolve(OUT)) continue;
    try {
      const h = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
      if (h === homeHash) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      }
    } catch {}
  }
}
walk(OUT);

// prune empty dirs (bottom-up)
function prune(dir) {
  let empty = true;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (prune(full)) fs.rmdirSync(full); else empty = false; }
    else empty = false;
  }
  return empty;
}
if (prune(OUT) === false) {} // keep site root regardless

console.log(`removed ${removed} homepage-clone dirs`);
const files = [];
(function count(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) count(f); else files.push(f);
  }
})(OUT);
console.log(`files remaining: ${files.length}`);
