// Mirror helisikahelicopters.co.nz as a static site for Cloudflare Pages.
// Crawls HTML pages, downloads assets, rewrites URLs to root-relative.
import fs from 'fs';
import path from 'path';

const ORIGIN = 'https://helisikahelicopters.co.nz';
const HOST = 'helisikahelicopters.co.nz';
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const OUT = path.join(HERE, 'site');
const CONCURRENCY = 6;

// paths to skip entirely (dynamic WP endpoints that make no sense static)
const SKIP = [
  /^\/wp-json\//, /^\/feed\/?$/, /^\/xmlrpc\.php/, /^\/wp-comments/,
  /^\/wp-login/, /^\/wp-admin/, /\?\w+_add-to-cart=/, /^\/cart/, /^\/checkout/,
  /^\/my-account/, /^\/shop/, /^\/product/, /^\/author\//, /^\/wp-cron/,
  /^\/comment-page-\d+/, /\/comment-page-\d+\//, /^\/\?replytome/, /replytocom=/,
  /^\/?s=/, /^\/search/, /^\?s=/, /\?share=/, /\?p=/, /\?page_id=/, /\?attachment_id=/,
  /^\/email-download/, /^\/(favicon|apple)[^\/]*$/, /^\/site\.webmanifest$/,
];

const assets = new Map();  // url -> { ok, file }
const pages = new Set();
const queue = ['/'];
let active = 0, done = false, errors = [];

function outPathFor(urlPath, isAsset) {
  // strip query/hash
  let p = urlPath.split('#')[0].split('?')[0];
  if (p === '' || p.endsWith('/')) return path.join(OUT, p, 'index.html');
  // assets keep their path; pages without trailing slash become dir/index.html
  if (!isAsset && !/\.\w{2,5}$/.test(p)) return path.join(OUT, p, 'index.html');
  return path.join(OUT, p);
}

async function fetchBuf(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (site mirror)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function shouldSkip(p) {
  if (!p.startsWith('/')) return true;
  return SKIP.some((r) => r.test(p));
}

function rewriteHtml(html) {
  // absolute & protocol-relative origin refs -> root-relative
  html = html.replaceAll(`https://${HOST}`, '').replaceAll(`http://${HOST}`, '').replaceAll(`//${HOST}`, '');
  return html;
}

function rewriteCss(css) {
  return css.replaceAll(`https://${HOST}`, '').replaceAll(`//${HOST}`, '');
}

function collectUrls(basePath, buf, isCss) {
  const text = buf.toString('utf8');
  const found = new Set();
  const add = (u) => {
    if (!u) return;
    // srcset values are comma-separated lists of "url descriptor" pairs
    if (u.includes(', ') && !u.startsWith('data:')) {
      for (const part of u.split(',')) {
        if (part.trim()) add(part.trim().split(/\s+/)[0]);
      }
      return;
    }
    u = u.trim();
    if (isCss && (u.startsWith('data:') || u.startsWith('#'))) return;
    if (u.startsWith('data:') || u.startsWith('mailto:') || u.startsWith('tel:') || u.startsWith('javascript:')) return;
    let p;
    if (u.startsWith('//')) p = u.replace(/^\/\//, 'https://'); // handled below
    else if (u.startsWith('https://') || u.startsWith('http://')) {
      try { const x = new URL(u); if (x.hostname !== HOST) return; p = x.pathname + x.search; } catch { return; }
    } else if (u.startsWith('/')) p = u;
    else if (isCss) return; // css relative refs resolved by path below
    else {
      // relative to page dir — resolve
      try { const x = new URL(u, ORIGIN + basePath); if (x.hostname !== HOST) return; p = x.pathname + x.search; } catch { return; }
      // meta-tag content junk ("width=device-width", "index,follow") is not a URL:
      // only accept relative refs that are real assets (have an extension) or directory links
      if (!/\.\w{2,5}$/.test(p) && !p.endsWith('/')) return;
    }
    if (shouldSkip(p)) return;
    // reject paths that can't be real site paths (junk from content="..." attrs)
    if (/[&=,\s]/.test(p)) return;
    found.add(p);
  };
  if (isCss) {
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) add(m[1]);
    for (const m of text.matchAll(/@import\s+['"]([^'"]+)['"]/g)) add(m[1]);
  } else {
    for (const m of text.matchAll(/(?:href|src|srcset|content)\s*=\s*["']([^"']+)["']/g)) add(m[1]);
    for (const m of text.matchAll(/"url"\s*:\s*"(https:\/\/[^"]+)"/g)) add(m[1]);
    // og:image etc
    for (const m of text.matchAll(new RegExp(`(https://${HOST.replace(/\./g, '\\.')}\\/[^"'\\s<>()]+)`, 'g'))) add(m[1]);
  }
  return [...found];
}

function classify(p) {
  // asset if extension suggests asset
  if (/\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|mp3|pdf|json|map|csv|wasm|ogv|vtt)$/i.test(p)) return 'asset';
  return 'page';
}

async function worker() {
  while (true) {
    const p = queue.shift();
    if (!p) { if (active === 0) { done = true; } return; }
    active++;
    try {
      const kind = classify(p);
      const isCss = /\.css($|\?)/i.test(p);
      const buf = await fetchBuf(ORIGIN + p);
      const file = outPathFor(p, kind === 'asset' || isCss);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let more = [];
      if (kind === 'page' && !isCss) {
        const html = rewriteHtml(buf.toString('utf8'));
        fs.writeFileSync(file, html);
        pages.add(p);
        for (const u of collectUrls(p, buf)) more.push(u);
      } else {
        if (isCss) {
          const css = rewriteCss(buf.toString('utf8'));
          fs.writeFileSync(file, css);
          for (const u of collectUrls(p, buf, true)) more.push(u);
          // resolve relative css refs relative to the css file dir
          for (let i = 0; i < more.length; i++) {
            if (!more[i].startsWith('/')) {
              try { more[i] = new URL(more[i], ORIGIN + p).pathname; } catch {}
            }
          }
        } else {
          fs.writeFileSync(file, buf);
        }
        assets.set(p, { ok: true, file: path.relative(OUT, file) });
      }
      for (const u of more) {
        const kindU = classify(u.split('#')[0]);
        const seenSet = kindU === 'page' && !/\.css$/i.test(u) ? pages : assets;
        if (!seenSet.has(u.split('#')[0].split('?')[0]) && !queue.includes(u)) queue.push(u);
      }
    } catch (e) {
      errors.push(String(e.message || e).slice(0, 160));
    } finally {
      active--;
    }
  }
}

const RESUME = process.argv.includes('--resume');
if (!RESUME) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const runners = Array.from({ length: CONCURRENCY }, () => worker());
// keep queue alive: workers exit when queue empty and active 0 — but they may push more.
async function pump() {
  while (!done) {
    await new Promise((r) => setTimeout(r, 200));
  }
}
await Promise.all([pump()]);

console.log(`pages: ${pages.size}, assets: ${assets.size}, errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 40)) console.log('  ERR ' + e);
