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
import type { CitationRenderer, CslItem } from '../../csl';
import type { AnnotatedExcerpt } from '../annotated-reading/resolve';
import type { SiteConfig } from './site-config';
import { noteUrl, type SiteIndex } from './site-data';
import { renderFootnotesSection } from '../note-html';
import { extractPublish, type PublishMeta } from './publish-meta';
import { type SidebarNode, subtreeContains } from './sidebar';

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
  /** Which section pages exist — gates the nav links. */
  nav: NavFlags;
}

/** Render a complete HTML page for a note. */
export async function renderNotePage(input: RenderPageInput): Promise<string> {
  const { note, plan, config, index, rootRelative, renderer, nav } = input;

  // Body via the existing markdown→HTML pipeline. The link policy is
  // forced to `follow-to-file` here (same as tree-html does) since the
  // bundle ships every note as an .html sibling — readers want
  // working cross-links inside the site.
  const sitePlan: ExportPlan = { ...plan, linkPolicy: 'follow-to-file' };
  const rawBody = await renderNoteBody(note, sitePlan, renderer ?? undefined);
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

  // Per-note social/OG meta + styling from the `publish:` frontmatter (#1136).
  const { headExtra, bodyStyle } = buildPublishHead(extractPublish(note), config, note.relativePath, note.title, rootRelative);

  return shell({
    config,
    rootRelative,
    pageTitle: note.title,
    bodyHtml: `<article>${bodyWithBroken}${backlinksHtml}</article>${sidebar}`,
    nav,
    currentPath: note.relativePath,
    ...(headExtra ? { headExtra } : {}),
    ...(bodyStyle ? { bodyStyle } : {}),
  });
}

/**
 * Build the per-note `<head>` additions (#1136): social/Open-Graph + Twitter
 * meta, canonical/og:url (only when `baseUrl` is set — otherwise absolute-URL
 * tags are cleanly omitted rather than emitting broken relative ones), and any
 * per-note stylesheet links. Every interpolated value is escaped; the
 * background is pre-validated to a safe CSS token by `extractPublish`.
 */
function buildPublishHead(
  meta: PublishMeta,
  config: SiteConfig,
  notePath: string,
  noteTitle: string,
  rootRelative: string,
): { headExtra: string; bodyStyle?: string } {
  const tags: string[] = [];
  if (meta.description) {
    const d = escapeAttr(meta.description);
    tags.push(`<meta name="description" content="${d}">`);
    tags.push(`<meta property="og:description" content="${d}">`);
    tags.push(`<meta name="twitter:description" content="${d}">`);
  }
  tags.push(`<meta property="og:title" content="${escapeAttr(noteTitle)}">`);
  tags.push(`<meta property="og:type" content="article">`);

  const base = config.baseUrl.trim().replace(/\/+$/, '');
  if (base) {
    const canonical = escapeAttr(`${base}/${noteUrl(notePath)}`);
    tags.push(`<link rel="canonical" href="${canonical}">`);
    tags.push(`<meta property="og:url" content="${canonical}">`);
  }
  // og:image must be an absolute URL (scrapers can't resolve relative ones).
  if (meta.image && /^https?:\/\//i.test(meta.image)) {
    const img = escapeAttr(meta.image);
    tags.push(`<meta property="og:image" content="${img}">`);
    tags.push(`<meta name="twitter:image" content="${img}">`);
    tags.push(`<meta name="twitter:card" content="summary_large_image">`);
  } else {
    tags.push(`<meta name="twitter:card" content="summary">`);
  }

  // Per-note stylesheets — linked after the site style.css so they override.
  for (const p of meta.cssPaths) {
    tags.push(`<link rel="stylesheet" href="${escapeAttr(`${rootRelative}${p}`)}">`);
  }

  const headExtra = tags.map((t) => `\n  ${t}`).join('');
  return meta.background ? { headExtra, bodyStyle: `background:${meta.background}` } : { headExtra };
}

/** Render the tag-cloud landing page (`tags/index.html`). */
export function renderTagCloud(config: SiteConfig, index: SiteIndex, rootRelative: string, nav: NavFlags): string {
  const sorted = [...index.tags.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const items = sorted.map(([tag, notes]) => (
    `<li><a href="${encodeURIComponent(tag)}.html">#${escapeHtml(tag)}<span class="count">${notes.length}</span></a></li>`
  )).join('');
  const body = `<article><h1>Tags</h1>${
    sorted.length === 0 ? '<p>No tags in this thoughtbase.</p>' : `<ul class="tag-cloud">${items}</ul>`
  }</article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative, pageTitle: 'Tags', bodyHtml: body, nav });
}

/** Render an individual tag page (`tags/<tag>.html`). */
export function renderTagPage(
  tag: string,
  notes: Array<{ relativePath: string; title: string }>,
  config: SiteConfig,
  rootRelative: string,
  nav: NavFlags,
): string {
  const items = notes.map((n) => (
    `<li><a href="${rootRelative}${escapeAttr(noteUrl(n.relativePath))}">${escapeHtml(n.title)}</a></li>`
  )).join('');
  const body = `<article><h1>#${escapeHtml(tag)}</h1><ul>${items}</ul></article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative, pageTitle: `#${tag}`, bodyHtml: body, nav });
}

/** Render an "All Notes" landing page when site-config.landing is empty. */
export function renderAllNotesIndex(notes: ExportPlanFile[], config: SiteConfig, nav: NavFlags): string {
  const sorted = [...notes].sort((a, b) => a.title.localeCompare(b.title));
  const items = sorted.map((n) => (
    `<li><a href="${escapeAttr(noteUrl(n.relativePath))}">${escapeHtml(n.title)}</a></li>`
  )).join('');
  const body = `<article><h1>${escapeHtml(config.title)}</h1><ul>${items}</ul></article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative: '', pageTitle: config.title, bodyHtml: body, nav });
}

/** Render the consolidated bibliography page (`references.html`). */
export function renderReferencesPage(
  entries: string[],
  isNote: boolean,
  config: SiteConfig,
  nav: NavFlags,
): string {
  const heading = isNote ? 'Bibliography' : 'References';
  const items = entries.map((e) => `<li>${e}</li>`).join('');
  const body = `<article><h1>${heading}</h1><section class="references"><ol>${items}</ol></section></article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative: '', pageTitle: heading, bodyHtml: body, nav });
}

// ── Source pages (#252 follow-up) ───────────────────────────────────────────

export interface RenderSourcePageInput {
  sourceId: string;
  /** Structured metadata; may be undefined if the source has no meta.ttl. */
  item: CslItem | undefined;
  /** Formatted CSL reference (one bibliography entry) as HTML. */
  citationHtml: string;
  /** Published notes that cite this source. */
  citedBy: Array<{ relativePath: string; title: string }>;
  /** The user's anchored excerpts from this source. */
  excerpts: AnnotatedExcerpt[];
  config: SiteConfig;
  nav: NavFlags;
}

/** Render a single source's page: reference + links + who cites it + excerpts.
 *  Deliberately does NOT republish the source body — only the user's own
 *  excerpts — so a public site stays bibliographic, not a re-host. */
export function renderSourcePage(input: RenderSourcePageInput): string {
  const { sourceId, item, citationHtml, citedBy, excerpts, config, nav } = input;
  const rootRelative = '../'; // sources/<id>.html → one level deep
  const title = item?.title ?? sourceId;

  const citation = citationHtml
    ? `<section class="source-citation">${citationHtml}</section>`
    : '';

  const links: string[] = [];
  if (item?.DOI) links.push(`<a href="https://doi.org/${escapeAttr(item.DOI)}">doi.org/${escapeHtml(item.DOI)}</a>`);
  if (item?.URL) links.push(`<a href="${escapeAttr(item.URL)}">${escapeHtml(item.URL)}</a>`);
  const linksHtml = links.length > 0 ? `<p class="source-links">${links.join(' · ')}</p>` : '';

  const abstract = item?.abstract
    ? `<section class="source-abstract"><h2>Abstract</h2><p>${escapeHtml(item.abstract)}</p></section>`
    : '';

  const citedByHtml = citedBy.length > 0
    ? `<section class="cited-by"><h2>Cited by</h2><ul>${
      citedBy.map((n) => `<li><a href="${rootRelative}${escapeAttr(noteUrl(n.relativePath))}">${escapeHtml(n.title)}</a></li>`).join('')
    }</ul></section>`
    : '';

  const excerptsHtml = excerpts.length > 0
    ? `<section class="source-excerpts"><h2>Excerpts</h2>${
      excerpts.map((ex) => {
        const loc = ex.locator ? `<cite class="loc">${escapeHtml(ex.locator)}</cite>` : '';
        const via = ex.linkedNotes.length > 0
          ? `<div class="excerpt-notes">In: ${
            ex.linkedNotes.map((n) => `<a href="${rootRelative}${escapeAttr(noteUrl(n.relativePath))}">${escapeHtml(n.title)}</a>`).join(', ')
          }</div>`
          : '';
        return `<blockquote class="excerpt">${loc}<p>${escapeHtml(ex.citedText)}</p>${via}</blockquote>`;
      }).join('')
    }</section>`
    : '';

  const body = `<article><h1>${escapeHtml(title)}</h1>${citation}${linksHtml}${abstract}${citedByHtml}${excerptsHtml}</article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative, pageTitle: title, bodyHtml: body, nav });
}

/** Render the sources index (`sources/index.html`). */
export function renderSourcesIndex(
  sources: Array<{ sourceId: string; title: string }>,
  config: SiteConfig,
  nav: NavFlags,
): string {
  const items = sources.map((s) => (
    `<li><a href="${escapeAttr(`${s.sourceId}.html`)}">${escapeHtml(s.title)}</a></li>`
  )).join('');
  const body = `<article><h1>Sources</h1>${
    sources.length === 0 ? '<p>No sources cited.</p>' : `<ul>${items}</ul>`
  }</article><aside class="note-meta"></aside>`;
  return shell({ config, rootRelative: '../', pageTitle: 'Sources', bodyHtml: body, nav });
}

/**
 * Which section pages the site actually emits — so the nav only links to
 * pages that exist. An always-on "Tags"/"References" link 404s on a site
 * without tags or citations, which is what a live GitHub Pages run hit.
 */
export interface NavFlags {
  hasTags: boolean;
  hasReferences: boolean;
  hasSources: boolean;
}

interface ShellInput {
  config: SiteConfig;
  rootRelative: string;
  pageTitle: string;
  bodyHtml: string;
  nav: NavFlags;
  /** Extra `<head>` markup — per-note social/OG meta + per-note stylesheet
   *  links (#1136). Already escaped by the caller. */
  headExtra?: string;
  /** Per-note background, validated to a safe CSS color/token (#1136). Applied
   *  as an inline style on `<body>`. */
  bodyStyle?: string;
  /** relativePath of the note this page renders, so the structure sidebar can
   *  highlight it and open its folder path (#1133). Empty for section pages. */
  currentPath?: string;
}

/** The left structure sidebar (#1133) — site brand (links home) + the folder/
 *  note tree, with the current note highlighted and its ancestors expanded.
 *  Rendered from the tree the exporter attached to `config` (built from the
 *  exported note set, so exclusions are respected). Empty when no tree. */
function renderSidebar(config: SiteConfig, rootRelative: string, currentPath: string): string {
  const tree = config.sidebarTree;
  if (!tree || tree.length === 0) return '';
  const brand = `<a class="site-brand" href="${escapeAttr(`${rootRelative}index.html`)}">${escapeHtml(config.title)}</a>`;
  return `<aside class="site-sidebar">${brand}<nav class="site-tree">${renderTreeNodes(tree, currentPath, rootRelative)}</nav></aside>`;
}

function renderTreeNodes(nodes: SidebarNode[], currentPath: string, rootRelative: string): string {
  const items = nodes.map((n) => {
    if (n.children) {
      const open = subtreeContains(n.children, currentPath) ? ' open' : '';
      return `<li class="tree-folder"><details${open}><summary>${escapeHtml(n.name)}</summary>${renderTreeNodes(n.children, currentPath, rootRelative)}</details></li>`;
    }
    const current = n.path === currentPath ? ' aria-current="page"' : '';
    return `<li class="tree-note"><a href="${escapeAttr(`${rootRelative}${noteUrl(n.path!)}`)}"${current}>${escapeHtml(n.name)}</a></li>`;
  });
  return `<ul>${items.join('')}</ul>`;
}

function shell(input: ShellInput): string {
  const { config, rootRelative, pageTitle, bodyHtml, nav } = input;
  const headExtra = input.headExtra ?? '';
  const bodyStyleAttr = input.bodyStyle ? ` style="${escapeAttr(input.bodyStyle)}"` : '';
  const sidebar = renderSidebar(config, rootRelative, input.currentPath ?? '');
  const navLink = (present: boolean, href: string, label: string): string =>
    present ? `\n  <a href="${escapeAttr(`${rootRelative}${href}`)}">${label}</a>` : '';
  const links =
    navLink(nav.hasTags, 'tags/index.html', 'Tags') +
    navLink(nav.hasReferences, 'references.html', 'References') +
    navLink(nav.hasSources, 'sources/index.html', 'Sources');
  // The sidebar-toggle checkbox precedes .site-layout so the CSS-only
  // `:checked ~ .site-layout .site-sidebar` reveal works on narrow screens.
  const toggle = sidebar
    ? '\n  <label for="site-sidebar-toggle" class="sidebar-toggle" aria-label="Toggle structure sidebar">☰</label>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)} — ${escapeHtml(config.title)}</title>
  <link rel="stylesheet" href="${rootRelative}style.css">${
    config.hasCustomCss ? `\n  <link rel="stylesheet" href="${rootRelative}site.css">` : ''
  }${headExtra}
</head>
<body data-search-root="${escapeAttr(rootRelative)}"${bodyStyleAttr}>
<nav class="site-nav">${toggle}
  <a class="site-title" href="${rootRelative}index.html">${escapeHtml(config.title)}</a>${links}
  <input class="site-search" type="search" placeholder="Search notes…" autocomplete="off">
</nav>
<div id="search-results" class="hidden"></div>
<input type="checkbox" id="site-sidebar-toggle" class="sidebar-toggle-cb" hidden>
<div class="site-layout">
${sidebar}
<main class="page">
${bodyHtml}
</main>
</div>
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
