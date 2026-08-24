/**
 * The docs-site model (#1842).
 *
 * `website/docs/` used to be 118 hand-maintained HTML pages in which ~36% of
 * the lines were byte-identical copy-pasted chrome, and "add a page" meant a
 * scripted edit across all 118 to insert its sidebar entry and fix its
 * neighbours' pagers. This module is the single source of truth those pages
 * are now generated from — `scripts/build-docs.mjs` writes the HTML,
 * `scripts/lib/extract-docs-corpus.mjs` reads the same fragments for the
 * in-app help corpus, and `tests/scripts/docs-generated.test.ts` asserts the
 * committed HTML still matches.
 *
 * Three inputs, all under `website/docs/`:
 *
 *   `_layout.html`   the chrome — head, top nav (inline SVG logo), the
 *                    `<div class="docs">` shell and the footer — with four
 *                    placeholders: {{title}}, {{description}}, {{sidebar}},
 *                    {{content}}. Verbatim from the pages it replaced.
 *   `_nav.json`      sections → items → optional children, each `{ href,
 *                    label }` plus optional `title`/`crumb` overrides. This one
 *                    file drives EVERY page's sidebar, breadcrumbs and
 *                    prev/next pager, so those can no longer drift page to
 *                    page — which they had: four sidebars were missing a
 *                    sibling added after they were last copy-pasted, and
 *                    conversations.html's "previous" still pointed two pages
 *                    back.
 *   `_content/*.html` one fragment per page, named for the page it produces.
 *
 * ## Why the fragments carry front-matter
 *
 * A page needs exactly three per-page inputs: `<title>`, the description meta,
 * and the `<main>` body between the crumbs and the pager. Everything else is
 * derived. Those first two are metadata about the fragment, so they live at the
 * top of the fragment rather than in a parallel JSON sidecar — one file to add,
 * one file to edit, nothing to keep in sync. The delimiter is the usual
 * `---` front-matter fence, parsed with a four-line reader instead of a YAML
 * dependency: both values are single-line HTML attribute/element text (a title
 * cannot contain `<`, a description cannot contain `"`), and body lines are
 * always indented, so a bare `---` can never appear where the fence is looked
 * for. `parseFragment` enforces the shape rather than trusting it.
 *
 * Strings in `_nav.json` and the fragments are HTML source, not plain text
 * (`Data &amp; workflows`) — they are substituted verbatim, never escaped.
 */

import fs from 'node:fs';
import path from 'node:path';

export const LAYOUT_FILE = '_layout.html';
export const NAV_FILE = '_nav.json';
export const CONTENT_DIR = '_content';
/** The docs root — the one page with no breadcrumb trail, and what the first
 *  crumb on every other page links back to. */
export const INDEX_PAGE = 'index.html';
const PLACEHOLDER = /\{\{(title|description|sidebar|content)\}\}/g;

/** An href that leaves `website/docs/` (e.g. `../getting-started.html`). Such a
 *  page still appears in the sidebar and still takes its turn in the pager
 *  chain, but it is not generated here and has no content fragment. */
export const isExternal = (href) => href.startsWith('../') || /^[a-z]+:/.test(href);

/**
 * Read `_nav.json` and flatten it into the lookups every renderer needs.
 * @param {string} docsDir
 */
export function loadNav(docsDir) {
  const nav = JSON.parse(fs.readFileSync(path.join(docsDir, NAV_FILE), 'utf-8'));
  const order = []; // depth-first: each top-level item, then its children
  const byHref = new Map();
  const parentOf = new Map();
  for (const section of nav.sections) {
    for (const item of section.items) {
      order.push(item.href);
      byHref.set(item.href, item);
      for (const child of item.children ?? []) {
        order.push(child.href);
        byHref.set(child.href, child);
        parentOf.set(child.href, item);
      }
    }
  }
  const dupes = order.filter((h, i) => order.indexOf(h) !== i);
  if (dupes.length) throw new Error(`${NAV_FILE}: duplicate href(s): ${dupes.join(', ')}`);
  return { sections: nav.sections, order, byHref, parentOf };
}

/** Pages the generator is responsible for, in nav order. */
export const generatedPages = (nav) => nav.order.filter((href) => !isExternal(href));

/** A page names itself in up to three registers, longest to shortest:
 *  `title` in the pager (the page's own name — `Data` is labelled `Working
 *  with data` there), `crumb` in the breadcrumb trail (where a long name like
 *  `The propose → review → approve loop` is shortened again), and `label` in
 *  the sidebar. Only `label` is required; each of the others falls back. */
const entry = (nav, href) => {
  const item = nav.byHref.get(href);
  if (!item) throw new Error(`${NAV_FILE}: no entry for ${href}`);
  return item;
};
const titleOf = (nav, href) => { const i = entry(nav, href); return i.title ?? i.label; };
const crumbOf = (nav, href) => { const i = entry(nav, href); return i.crumb ?? i.title ?? i.label; };

/**
 * Split a `_content/*.html` fragment into its front-matter and body.
 * @param {string} raw
 * @param {string} name for error messages
 */
export function parseFragment(raw, name) {
  const fence = '---\n';
  if (!raw.startsWith(fence)) throw new Error(`${name}: missing opening --- front-matter fence`);
  const end = raw.indexOf(`\n${fence}`, fence.length - 1);
  if (end === -1) throw new Error(`${name}: missing closing --- front-matter fence`);
  const meta = {};
  for (const line of raw.slice(fence.length, end + 1).split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf(': ');
    if (at === -1) throw new Error(`${name}: front-matter line is not "key: value": ${line}`);
    meta[line.slice(0, at)] = line.slice(at + 2);
  }
  for (const key of ['title', 'description']) {
    if (!meta[key]) throw new Error(`${name}: front-matter is missing "${key}"`);
  }
  const body = raw.slice(end + 1 + fence.length).replace(/^\n+/, '').replace(/\n+$/, '');
  if (!body) throw new Error(`${name}: empty body`);
  return { title: meta.title, description: meta.description, body };
}

/** Read every content fragment, keyed by the page it produces. */
export function loadFragments(docsDir) {
  const dir = path.join(docsDir, CONTENT_DIR);
  const out = new Map();
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort()) {
    out.set(name, parseFragment(fs.readFileSync(path.join(dir, name), 'utf-8'), `${CONTENT_DIR}/${name}`));
  }
  return out;
}

/** The `<aside class="docs-nav">` inner HTML for one page: the flat top-level
 *  list, with only the active page's own family expanded beneath its parent. */
function renderSidebar(nav, href) {
  const family = nav.parentOf.get(href)?.href ?? href;
  const lines = [];
  for (const section of nav.sections) {
    if (lines.length) lines.push('');
    lines.push(`    <h4>${section.label}</h4>`);
    for (const item of section.items) {
      lines.push(`    <a href="${item.href}"${item.href === href ? ' class="active"' : ''}>${item.label}</a>`);
      if (item.href !== family) continue;
      for (const child of item.children ?? []) {
        lines.push(`    <a href="${child.href}" class="sub${child.href === href ? ' active' : ''}">${child.label}</a>`);
      }
    }
  }
  return lines.join('\n');
}

/** `Docs / [family] / Page` — the family link only on a child page. The docs
 *  root is its own root, so it gets no crumbs at all. */
function renderCrumbs(nav, href) {
  if (href === INDEX_PAGE) return null;
  const sep = '<span class="sep">/</span>';
  const parent = nav.parentOf.get(href);
  const mid = parent ? `<a href="${parent.href}">${crumbOf(nav, parent.href)}</a>${sep}` : '';
  return `    <p class="crumbs"><a href="${INDEX_PAGE}">Docs</a>${sep}${mid}${crumbOf(nav, href)}</p>`;
}

/** Prev/next from the depth-first nav order, with an empty `<span>` holding
 *  the slot at either end so the flex row keeps "next" on the right. */
function renderPager(nav, href) {
  const i = nav.order.indexOf(href);
  const link = (dir, target, dirLabel, ttl) => [
    `      <a class="${dir}" href="${target}">`,
    `        <span class="dir">${dirLabel}</span>`,
    `        <span class="ttl">${ttl}</span>`,
    '      </a>',
  ].join('\n');
  const prev = nav.order[i - 1];
  const next = nav.order[i + 1];
  return [
    '    <div class="pager">',
    prev ? link('prev', prev, 'Previous', `← ${titleOf(nav, prev)}`) : '      <span></span>',
    next ? link('next', next, 'Next', `${titleOf(nav, next)} →`) : '      <span></span>',
    '    </div>',
  ].join('\n');
}

/**
 * Render one page.
 * @param {string} layout contents of `_layout.html`
 * @param {ReturnType<typeof loadNav>} nav
 * @param {string} href page filename, e.g. `right-sidebar-history.html`
 * @param {{ title: string, description: string, body: string }} fragment
 */
export function renderPage(layout, nav, href, fragment) {
  const crumbs = renderCrumbs(nav, href);
  const content = [crumbs, fragment.body, renderPager(nav, href)].filter(Boolean).join('\n\n');
  const values = {
    title: fragment.title,
    description: fragment.description,
    sidebar: renderSidebar(nav, href),
    content,
  };
  const unknown = layout.replace(PLACEHOLDER, '').match(/\{\{[^}]*\}\}/);
  if (unknown) throw new Error(`${LAYOUT_FILE}: unknown placeholder ${unknown[0]}`);
  // A function replacer, never a string one: docs prose is full of `$$…$$`
  // (display math) and would contain `$&`, both of which `String.replace` reads
  // as substitution patterns in a *string* replacement and silently eats —
  // that turned every `$$…$$` in notes-math.html into `$…$`.
  return layout.replace(PLACEHOLDER, (_, key) => values[key]);
}

/**
 * Render every page. Returns filename → HTML, in nav order.
 * @param {string} docsDir
 */
export function buildDocs(docsDir) {
  const layout = fs.readFileSync(path.join(docsDir, LAYOUT_FILE), 'utf-8');
  const nav = loadNav(docsDir);
  const fragments = loadFragments(docsDir);
  const pages = generatedPages(nav);
  const missing = pages.filter((href) => !fragments.has(href));
  if (missing.length) throw new Error(`${NAV_FILE} lists pages with no ${CONTENT_DIR}/ fragment: ${missing.join(', ')}`);
  const orphans = [...fragments.keys()].filter((href) => !nav.byHref.has(href));
  if (orphans.length) throw new Error(`${CONTENT_DIR}/ fragments missing from ${NAV_FILE}: ${orphans.join(', ')}`);
  return new Map(pages.map((href) => [href, renderPage(layout, nav, href, fragments.get(href))]));
}
