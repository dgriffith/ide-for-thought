/**
 * Extraction for the help-docs corpus (#1283, part of #1154's epic:docs-grounding).
 *
 * Turns the user-facing docs site (`website/docs/*.html`) into indexable text
 * chunks — one per `<h2>` section, plus a preamble chunk (h1 + lede) per page —
 * so the in-app assistant can ground "how do I…" answers in Minerva's real
 * documentation instead of guessing from training-data priors about a product
 * it's never seen.
 *
 * Every docs page shares one template (verified across all 76 pages): content
 * lives entirely inside `<main class="docs-content">`, is headed by an `<h1>`
 * + `<p class="lede">`, and is split into `<h2 id="...">` sections — chrome
 * (`<nav>`, `<aside class="docs-nav">`, `<footer>`) lives outside `<main>` and
 * is never touched by scoping extraction there. `.crumbs`/`.pager` are the two
 * bits of navigation noise that live *inside* `<main>`, so those are removed
 * explicitly. `.shot` screenshot-placeholder captions are also dropped: they
 * mostly restate the surrounding prose ("Screenshot — X: a rendered note
 * showing Y") in service of a not-yet-taken screenshot, so keeping them would
 * dilute a chunk's embedding without adding real instructional content.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

const DEFAULT_MAX_CHARS = 1000;
const NOISE_SELECTORS = ['.crumbs', '.pager', '.shot'];

/**
 * Extract indexable chunks from one docs page's HTML.
 * Pure — no filesystem access — so it's directly unit-testable against fixtures.
 *
 * @param {string} html
 * @param {string} sourcePage e.g. "notes-links.html"
 * @param {{ maxChars?: number }} [opts]
 * @returns {{ id: string, sourcePage: string, pageTitle: string, heading: string, text: string }[]}
 */
export function extractPageChunks(html, sourcePage, opts = {}) {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const { document } = parseHTML(html);
  const main = document.querySelector('main.docs-content');
  if (!main) return [];

  for (const selector of NOISE_SELECTORS) {
    main.querySelectorAll(selector).forEach((el) => el.remove());
  }

  const pageTitle = elementText(main.querySelector('h1'));

  const chunks = [];
  let heading = '';
  let sectionId = null; // null while in the preamble (before the first h2)
  let blocks = [];

  const flush = () => {
    const text = blocks.filter(Boolean).join('\n\n');
    blocks = [];
    if (!text) return;
    const id = sectionId ? `${sourcePage}#${sectionId}` : sourcePage;
    for (const piece of splitLong(text, maxChars)) {
      chunks.push({ id, sourcePage, pageTitle, heading, text: piece });
    }
  };

  for (const child of Array.from(main.children)) {
    if (child.tagName === 'H1') continue; // captured separately as pageTitle
    if (child.tagName === 'H2') {
      flush();
      heading = elementText(child);
      sectionId = child.getAttribute('id') || slugify(heading);
      continue;
    }
    blocks.push(...blockPieces(child));
  }
  flush();

  return chunks;
}

/**
 * Text piece(s) for one top-level content element. `.deflist`/`.doc-cards`
 * containers and `<ul>`/`<ol>` lists are expanded into one piece per
 * row/card/item — their natural paragraph-equivalent boundaries — rather than
 * one opaque blob for the whole container. Otherwise a long list (e.g. a
 * 12-row typed-link table, or a 14-card hub page) collapses into a single
 * "paragraph" that `splitLong` can only hard-slice mid-word when it overflows
 * `maxChars`, instead of packing whole rows/items up to the limit.
 */
function blockPieces(el) {
  if (el.matches?.('.deflist')) {
    return Array.from(el.querySelectorAll('.row')).map(joinChildren).filter(Boolean);
  }
  if (el.matches?.('.doc-cards')) {
    return Array.from(el.querySelectorAll('.doc-card')).map(joinChildren).filter(Boolean);
  }
  if (el.tagName === 'UL' || el.tagName === 'OL') {
    return Array.from(el.querySelectorAll('li')).map(elementText).filter(Boolean);
  }
  const text = elementText(el);
  return text ? [text] : [];
}

/** Join a `.row`/`.doc-card`'s direct children (e.g. `.k`+`.v`, or `.icon`+
 *  `h3`+`p`) with an explicit space. Adjacent block-level children with no
 *  whitespace text node between them in the source (compact/minified markup)
 *  would otherwise run together via plain `.textContent` — this doesn't
 *  depend on incidental source formatting. */
function joinChildren(el) {
  return Array.from(el.children).map(elementText).filter(Boolean).join(' ');
}

/**
 * Extract chunks from every `*.html` page in a docs directory (i.e.
 * `website/docs`). Touches the filesystem — the I/O counterpart to
 * {@link extractPageChunks}, used by the build-time embedding script.
 *
 * @param {string} docsDir
 * @param {{ maxChars?: number }} [opts]
 */
export function extractDocsCorpus(docsDir, opts = {}) {
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.html')).sort();
  const chunks = [];
  for (const file of files) {
    const html = fs.readFileSync(path.join(docsDir, file), 'utf-8');
    chunks.push(...extractPageChunks(html, file, opts));
  }
  return chunks;
}

function elementText(el) {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Sub-split an over-long section on blank-line (paragraph) boundaries, packing
 *  paragraphs up to `maxChars`. Mirrors `src/main/embeddings/chunk.ts`'s
 *  `splitLong`, adapted for a text blob already joined with `\n\n` per
 *  top-level block (a row/item/paragraph — see `blockPieces`) rather than
 *  markdown lines. A single over-long paragraph is packed by sentence instead
 *  of hard-sliced by character count, so a long lede/prose paragraph never
 *  gets cut mid-word — only a single run-on *sentence* longer than `maxChars`
 *  (essentially never, in hand-written docs prose) falls back to a raw slice. */
function splitLong(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n\n+/);
  const out = [];
  let buf = '';
  const push = () => { if (buf) { out.push(buf); buf = ''; } };
  const pack = (piece) => {
    if (buf.length + piece.length + 1 > maxChars) push();
    buf = buf ? `${buf} ${piece}` : piece;
  };
  for (const para of paras) {
    if (para.length <= maxChars) {
      if (buf.length + para.length + 2 > maxChars) push();
      buf = buf ? `${buf}\n\n${para}` : para;
      continue;
    }
    push();
    for (const sentence of para.split(/(?<=[.!?])\s+/)) {
      if (sentence.length > maxChars) {
        push();
        for (let i = 0; i < sentence.length; i += maxChars) out.push(sentence.slice(i, i + maxChars));
        continue;
      }
      pack(sentence);
    }
    push();
  }
  push();
  return out;
}
