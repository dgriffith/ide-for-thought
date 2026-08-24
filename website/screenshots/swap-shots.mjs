// Swap the `.shot wide` placeholder for a real captured <figure><img> on every
// docs page that has a matching image in website/docs/img/<page>.png.
//
// Edits the docs CONTENT FRAGMENTS (`website/docs/_content/*.html`), not the
// generated pages — `website/docs/*.html` is output, and a write there would be
// undone by the next `pnpm build:docs` (#1842).
//
// Convention: the captured image id === the page basename (notes-callouts.png ↔
// notes-callouts.html). Idempotent — pages already swapped, or without an image,
// are left untouched. Run after a capture pass, then regenerate:
//   node website/screenshots/swap-shots.mjs && pnpm build:docs
import fs from 'node:fs';
import path from 'node:path';

const DOCS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const IMG = path.join(DOCS, 'img');
const CONTENT = path.join(DOCS, '_content');
const esc = (s) => s.replace(/"/g, '&quot;');

// The first `.shot wide` placeholder block, capturing .k (caption, optional) and
// .d (alt/description). Some placeholders omit the .k caption.
const RE = /[ \t]*<div class="shot wide">\s*<div class="icon">[\s\S]*?<\/div>\s*(?:<div class="k">([\s\S]*?)<\/div>\s*)?<div class="d">([\s\S]*?)<\/div>\s*<\/div>/;

const only = process.argv.slice(2); // optional page-basename allowlist
let swapped = 0;
const skipped = [];

for (const file of fs.readdirSync(CONTENT).filter((f) => f.endsWith('.html'))) {
  const id = file.replace(/\.html$/, '');
  if (only.length && !only.includes(id)) continue;
  if (!fs.existsSync(path.join(IMG, `${id}.png`))) continue; // no image yet
  const p = path.join(CONTENT, file);
  let html = fs.readFileSync(p, 'utf8');
  const m = html.match(RE);
  if (!m) { skipped.push(`${id} (no .shot wide placeholder)`); continue; }
  const caption = (m[1] ?? '').trim();
  const alt = m[2].trim().replace(/\s+/g, ' ');
  const figcaption = caption ? `\n      <figcaption>${caption}</figcaption>` : '';
  const figure =
    `    <figure class="shot-img">\n` +
    `      <img src="img/${id}.png" alt="${esc(alt)}" loading="lazy" />${figcaption}\n` +
    `    </figure>`;
  fs.writeFileSync(p, html.replace(RE, figure));
  swapped++;
}
console.log(
  `Swapped ${swapped} page(s).` +
  (skipped.length ? ` Note: ${skipped.join('; ')}` : '') +
  (swapped ? ' Run `pnpm build:docs` to regenerate website/docs/*.html.' : ''),
);
