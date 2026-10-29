// Find every .mp4 reference in the mirrored HTML/CSS/JS.
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const OUT = path.join(HERE, 'site');
const refs = new Map();
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(html|css|js)$/i.test(e.name)) {
      const t = fs.readFileSync(f, 'utf8');
      for (const m of t.matchAll(/[^\s"'()<>=]*\.mp4/gi)) {
        const r = m[0];
        if (!refs.has(r)) refs.set(r, []);
        refs.get(r).push(path.relative(OUT, f));
      }
    }
  }
})(OUT);
if (refs.size === 0) console.log('no mp4 refs');
for (const [r, files] of [...refs].sort()) console.log(r, '<-', files.slice(0, 3).join(', '));
