// List nested homepage-clone dirs (WordPress catch-all) and all page paths.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const OUT = path.join(HERE, 'site');

const homeHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, 'index.html'))).digest('hex');
const clones = [];
const pages = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/^index\.html?$/i.test(entry.name)) continue;
    const rel = path.relative(OUT, path.dirname(full)).replace(/\\/g, '/');
    pages.push(rel === '' ? '/' : '/' + rel + '/');
    const h = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
    if (h === homeHash && rel !== '') clones.push('/' + rel + '/');
  }
}
walk(OUT);
console.log('homepage-clone dirs:');
for (const c of clones) console.log('  ' + c);
console.log(`pages (${pages.length}):`);
for (const p of pages.sort()) console.log('  ' + p);
