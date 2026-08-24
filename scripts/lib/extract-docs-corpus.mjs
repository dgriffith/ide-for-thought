/**
 * Extraction for the help-docs corpus (#1283, part of #1154's epic:docs-grounding).
 *
 * Turns the user-facing docs site into indexable text chunks — one per `<h2>`
 * section, plus a preamble chunk (h1 + lede) per page — so the in-app
 * assistant can ground "how do I…" answers in Minerva's real documentation
 * instead of guessing from training-data priors about a product it's never
 * seen.
 *
 * **The input is `website/docs/_content/*.html`, not the generated pages**
 * (#1842). Those fragments — one per page, body only — are exactly the
 * per-page content the docs generator wraps in shared chrome, so reading them
 * means never re-parsing chrome back out of the output it was just injected
 * into. Chunk ids are unchanged by the switch: a fragment is named for the
 * page it produces, and the crumbs/pager the old scoping had to strip aren't
 * in a fragment to begin with.
 *
 * Every page shares one template: content is headed by an `<h1>` +
 * `<p class="lede">` and split into `<h2 id="...">` sections.
 * {@link extractPageChunks} still takes a whole page and scopes itself to
 * `<main class="docs-content">`, so it works on either shape; `.crumbs` and
 * `.pager` stay in `NOISE_SELECTORS` for that path. `.shot`
 * screenshot-placeholder captions are dropped from both: they mostly restate
 * the surrounding prose ("Screenshot — X: a rendered note showing Y") in
 * service of a not-yet-taken screenshot, so keeping them would dilute a
 * chunk's embedding without adding real instructional content.
 */

import { parseHTML } from 'linkedom';
import { loadFragments } from './docs-model.mjs';

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
 * Extract chunks from one content fragment's body. Pure, like
 * {@link extractPageChunks} — the body is wrapped in the `<main>` the rest of
 * this module scopes to, rather than duplicating the walk.
 *
 * @param {string} body a `_content/*.html` body (no chrome, no crumbs, no pager)
 * @param {string} sourcePage e.g. "notes-links.html"
 * @param {{ maxChars?: number }} [opts]
 */
export function extractFragmentChunks(body, sourcePage, opts = {}) {
  return extractPageChunks(`<main class="docs-content">${body}</main>`, sourcePage, opts);
}

/**
 * Extract chunks from every content fragment under a docs directory (i.e.
 * `website/docs`, whose fragments live in `website/docs/_content`). Touches the
 * filesystem — the I/O counterpart to {@link extractFragmentChunks}, used by
 * the build-time embedding script.
 *
 * @param {string} docsDir
 * @param {{ maxChars?: number }} [opts]
 */
export function extractDocsCorpus(docsDir, opts = {}) {
  const chunks = [];
  for (const [page, fragment] of loadFragments(docsDir)) {
    chunks.push(...extractFragmentChunks(fragment.body, page, opts));
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
