// Swap the `.shot` placeholders on the marketing pages (index / features /
// getting-started) for real captured <figure><img>, using the images written by
// capture-marketing.spec.ts into website/img/<id>.png.
//
// Each placeholder is tagged (on first run) with `data-shot="<id>"` from the
// per-page MANIFEST below — the ordered list of image ids matching the page's
// `.shot` blocks top-to-bottom. A placeholder is swapped only once its image
// exists, so this is idempotent and safe to re-run after capturing more shots:
//   node website/screenshots/swap-marketing-shots.mjs
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IMG = path.join(WEB, 'img');
const esc = (s) => s.replace(/"/g, '&quot;');

/** Ordered image id per `.shot` placeholder, top-to-bottom, per page. Reusing an
 *  id (e.g. the hero on both pages) points multiple placeholders at one image. */
const MANIFEST = {
  'index.html': ['index-hero', 'thoughtbase-depth', 'proposal-review'],
  'features.html': [
    'index-hero', 'thoughtbase-depth', 'editor-split', 'ai-from-graph',
    'data-analysis', 'skills-menu', 'proposal-review', 'clipper-source', 'export-menu',
  ],
  'getting-started.html': ['onboarding'],
};

/** Build the <figure> replacement from a placeholder's size-modifier class, id,
 *  and its `.k`/`.d` text (caption / alt). */
function figure(mod, id, k, d) {
  const alt = (d ?? '').trim().replace(/\s+/g, ' ');
  const caption = (k ?? '').trim().replace(/^Screenshot\s*[—-]\s*/i, '').replace(/^Screenshot\s*\/\s*screencast\s*[—-]\s*/i, '');
  const cls = `shot-img${mod}`.replace(/\bwide\b/, '').replace(/\s+/g, ' ').trim();
  const figcaption = caption ? `\n      <figcaption>${esc(caption)}</figcaption>` : '';
  return `<figure class="${cls}">\n      <img src="img/${id}.png" alt="${esc(alt)}" loading="lazy" />${figcaption}\n    </figure>`;
}

// A `.shot` placeholder block: captures the size-modifier class, optional data-shot
// id, optional `.k`, and `.d`.
const BLOCK = (dataShot) => new RegExp(
  `<div class="shot([^"]*)"${dataShot ? ` data-shot="([^"]*)"` : `(?!\\s+data-shot)`}>` +
  `\\s*<div class="icon">[\\s\\S]*?</div>` +
  `\\s*(?:<div class="k">([\\s\\S]*?)</div>\\s*)?` +
  `<div class="d">([\\s\\S]*?)</div>\\s*</div>`,
  'g',
);

let swapped = 0, stamped = 0;

for (const [page, ids] of Object.entries(MANIFEST)) {
  const file = path.join(WEB, page);
  if (!fs.existsSync(file)) continue;
  let html = fs.readFileSync(file, 'utf8');

  // Pass 1 — already-stamped placeholders: swap any whose image now exists.
  html = html.replace(BLOCK(true), (m, mod, id, k, d) => {
    if (!fs.existsSync(path.join(IMG, `${id}.png`))) return m; // still pending
    swapped++;
    return figure(mod, id, k, d);
  });

  // Pass 2 — fresh (unstamped) placeholders: assign ids positionally, then swap
  // if the image exists, otherwise stamp the id so a later run can find it.
  let i = 0;
  html = html.replace(BLOCK(false), (m, mod, k, d) => {
    const id = ids[i++];
    if (!id) return m; // more placeholders than manifest entries — leave as-is
    if (fs.existsSync(path.join(IMG, `${id}.png`))) { swapped++; return figure(mod, id, k, d); }
    stamped++;
    return m.replace(/^<div class="shot([^"]*)">/, `<div class="shot$1" data-shot="${id}">`);
  });

  fs.writeFileSync(file, html);
}

console.log(`swapped ${swapped} image(s); stamped ${stamped} pending placeholder(s).`);
