/**
 * Static-site page renderer (#252).
 *
 * Reuses the note-html body renderer (cite/quote rules, wiki-link
 * resolution, code highlighting) but wraps it in the site's nav-shell
 * + per-note metadata sidebar + backlinks footer. The note-html
 * exporter is single-artifact-shaped; this is the same output dressed
 * up as a multi-page site.
 */

import path from 'node:path';
import { renderNoteBody } from '../note-html/render';
import type { ExportPlanFile, ExportPlan } from '../../types';
import type { CitationRenderer } from '../../csl';
import type { SiteConfig } from './site-config';
import { noteUrl, type SiteIndex } from './site-data';
import { renderFootnotesSection } from '../note-html';

export interface RenderPageInput {
  note: ExportPlanFile;
  plan: ExportPlan;
  config: SiteConfig;
  index: SiteIndex;
  /**
   * Number of `../` segments to climb from this page to the site
   * root. Lets the nav, search input, and stylesheet links resolve
   * cleanly from any depth.
   */
  rootRelative: string;
  /** Per-note CSL renderer; null when the project has no citation assets. */
  renderer: CitationRenderer | null;
}

/** Render a complete HTML page for a note. */
export function renderNotePage(input: RenderPageInput): string {
  const { note, plan, config, index, rootRelative, renderer } = input;

  // Body via the existing markdown→HTML pipeline. The link policy is
  // forced to `follow-to-file` here (same as tree-html does) since the
  // bundle ships every note as an .html sibling — readers want
  // working cross-links inside the site.
  const sitePlan: ExportPlan = { ...plan, linkPolicy: 'follow-to-file' };
  const rawBody = renderNoteBody(note, sitePlan, renderer ?? undefined);
  const bodyWithFootnotes = renderer ? `${rawBody}${renderFootnotesSection(renderer)}` : rawBody;
  const bodyWithBroken = markBrokenWikiLinks(bodyWithFootnotes);

  // Backlinks section — only when at least one inbound link exists.
  const backlinkEntries = config.showBacklinks ? (index.backlinks.get(note.relativePath) ?? []) : [];
  const backlinksHtml = backlinkEntries.length > 0
    ? `<section class="backlinks"><h2>Linked from</h2><ul>${
      backlinkEntries.map((b) => `<li><a href="${rootRelative}${escapeAttr(noteUrl(b.relativePath))}">${escapeHtml(b.title)}</a></li>`).join('')
    }</ul></section>`
    : '';

  // Per-note metadata sidebar.
  const tags = extractTagList(note);
  const metaTags = tags.length > 0
    ? `<h3>Tags</h3><ul>${tags.map((t) => `<li><a href="${rootRelative}tags/${encodeURIComponent(t)}.html">#${escapeHtml(t)}</a></li>`).join('')}</ul>`
    : '';
  const date = typeof note.frontmatter.date === 'string' ? note.frontmatter.date : '';
  const metaDate = date ? `<h3>Date</h3><ul><li>${escapeHtml(date)}</li></ul>` : '';
  const sidebar = (metaTags || metaDate)
    ? `<aside class="note-meta">${metaTags}${metaDate}</aside>`
    : '<aside class="note-meta"></aside>';

  return shell({
    config,
    rootRelative,
    pageTitle: note.title,
    bodyHtml: `<article>${bodyWithBroken}${backlinksHtml}</article>${sidebar}`,
  });
}

/** Render the tag-cloud landing page (`tags/index.html`). */
export function renderTagCloud(config: SiteConfig, index: SiteIndex, rootRelative: string): string {
  const sorted = [...index.tags.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const items = sorted.map(([tag, notes]) => (
    `<li><a href="${encodeURIComponent(tag)}.html">#${escapeHtml(tag)}<span class="count">${notes.length}</span></a></li>`
  )).join('');
  const body = `<article><h1>Tags</h1>${
    sorted.length === 0 ? '<p>No tags in this thoughtbase.</p>' : `<ul class="tag-cloud">${items}</ul>`
  }</article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative, pageTitle: 'Tags', bodyHtml: body });
}

/** Render an individual tag page (`tags/<tag>.html`). */
export function renderTagPage(
  tag: string,
  notes: Array<{ relativePath: string; title: string }>,
  config: SiteConfig,
  rootRelative: string,
): string {
  const items = notes.map((n) => (
    `<li><a href="${rootRelative}${escapeAttr(noteUrl(n.relativePath))}">${escapeHtml(n.title)}</a></li>`
  )).join('');
  const body = `<article><h1>#${escapeHtml(tag)}</h1><ul>${items}</ul></article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative, pageTitle: `#${tag}`, bodyHtml: body });
}

/** Render an "All Notes" landing page when site-config.landing is empty. */
export function renderAllNotesIndex(notes: ExportPlanFile[], config: SiteConfig): string {
  const sorted = [...notes].sort((a, b) => a.title.localeCompare(b.title));
  const items = sorted.map((n) => (
    `<li><a href="${escapeAttr(noteUrl(n.relativePath))}">${escapeHtml(n.title)}</a></li>`
  )).join('');
  const body = `<article><h1>${escapeHtml(config.title)}</h1><ul>${items}</ul></article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative: '', pageTitle: config.title, bodyHtml: body });
}

/** Render the consolidated bibliography page (`references.html`). */
export function renderReferencesPage(
  entries: string[],
  isNote: boolean,
  config: SiteConfig,
): string {
  const heading = isNote ? 'Bibliography' : 'References';
  const items = entries.map((e) => `<li>${e}</li>`).join('');
  const body = `<article><h1>${heading}</h1><section class="references"><ol>${items}</ol></section></article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative: '', pageTitle: heading, bodyHtml: body });
}

interface ShellInput {
  config: SiteConfig;
  rootRelative: string;
  pageTitle: string;
  bodyHtml: string;
}

function shell(input: ShellInput): string {
  const { config, rootRelative, pageTitle, bodyHtml } = input;
  const tagsHref = `${rootRelative}tags/index.html`;
  const refsHref = `${rootRelative}references.html`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)} — ${escapeHtml(config.title)}</title>
  <link rel="stylesheet" href="${rootRelative}style.css">
</head>
<body data-search-root="${escapeAttr(rootRelative)}">
<nav class="site-nav">
  <a class="site-title" href="${rootRelative}index.html">${escapeHtml(config.title)}</a>
  <a href="${escapeAttr(tagsHref)}">Tags</a>
  <a href="${escapeAttr(refsHref)}">References</a>
  <input class="site-search" type="search" placeholder="Search notes…" autocomplete="off">
</nav>
<div id="search-results" class="hidden"></div>
<main class="page">
${bodyHtml}
</main>
<script src="${rootRelative}search.js" defer></script>
</body>
</html>`;
}

/**
 * Mark unresolved wiki-links — the markdown body renderer emits them
 * as `<em class="wikilink-unresolved">...</em>`. The static site's
 * acceptance criterion calls for a strikethrough rendering visible to
 * the user, so we promote the `wikilink-unresolved` class to
 * `wikilink-broken` (which the stylesheet styles with line-through).
 */
function markBrokenWikiLinks(html: string): string {
  return html.replace(/<em class="wikilink-unresolved">/g, '<em class="wikilink-broken">');
}

function extractTagList(note: ExportPlanFile): string[] {
  const fmTags = note.frontmatter.tags;
  if (Array.isArray(fmTags)) {
    return fmTags
      .filter((t): t is string | number => typeof t === 'string' || typeof t === 'number')
      .map((t) => String(t).trim())
      .filter(Boolean);
  }
  if (typeof fmTags === 'string') {
    return fmTags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s: string): string { return escapeHtml(s); }

// Suppress unused-helper warnings for `path` import — used by future
// asset-copy code; left so the module's expected import shape stays
// stable.
void path;
