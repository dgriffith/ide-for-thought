/**
 * Cite / quote / footnote metadata helpers extracted from Preview.svelte
 * (#672, #110 citations). `collapseCiteRows` / `formatFullByline` and the
 * tooltip builders are pure; `buildFootnoteTooltip` is a pure DOM→string
 * transform over a passed-in element. No stores, no reactivity.
 */
import { escapeHtml } from './text';

// Cite/quote metadata bundles: id → resolved bundle.
export interface CiteMeta {
  title?: string;
  creators: string[];
  year?: string;
  doi?: string;
  uri?: string;
}
export interface QuoteMeta {
  citedText?: string;
  sourceTitle?: string;
  sourceCreator?: string;
  sourceYear?: string;
  page?: string;
  pageRange?: string;
  locationText?: string;
}

export function collapseCiteRows(rows: Array<Record<string, string>>): CiteMeta {
  const meta: CiteMeta = { creators: [] };
  const creatorSet = new Set<string>();
  for (const row of rows) {
    if (row.title && !meta.title) meta.title = row.title;
    if (row.creator && !creatorSet.has(row.creator)) {
      creatorSet.add(row.creator);
      meta.creators.push(row.creator);
    }
    if (row.issued && !meta.year) meta.year = row.issued.slice(0, 4);
    if (row.doi && !meta.doi) meta.doi = row.doi;
    if (row.uri && !meta.uri) meta.uri = row.uri;
  }
  return meta;
}

/**
 * Clone the footnote-body `<li>` minus its back-arrow anchor and the
 * surrounding `<p>` wrapper, leaving the bare body text. markdown-it-
 * footnote always wraps the body in one or more `<p>` elements with
 * a trailing `<a class="footnote-backref">↩</a>`; stripping the
 * backref and reusing the cleaned innerHTML keeps the tooltip a faithful
 * mini-render of the footnote prose (links, emphasis, code spans
 * all preserved).
 */
export function buildFootnoteTooltip(body: HTMLElement): string {
  const clone = body.cloneNode(true) as HTMLElement;
  for (const bk of clone.querySelectorAll('.footnote-backref')) bk.remove();
  return `<div class="tt-footnote">${clone.innerHTML.trim()}</div>`;
}

export function buildCiteTooltip(meta: CiteMeta): string {
  const parts: string[] = [];
  if (meta.title) parts.push(`<div class="tt-title">${escapeHtml(meta.title)}</div>`);
  const byline = formatFullByline(meta.creators, meta.year);
  if (byline) parts.push(`<div class="tt-byline">${escapeHtml(byline)}</div>`);
  if (meta.doi) parts.push(`<div class="tt-meta">DOI: ${escapeHtml(meta.doi)}</div>`);
  else if (meta.uri) parts.push(`<div class="tt-meta">${escapeHtml(meta.uri)}</div>`);
  return parts.join('') || `<div class="tt-meta">No metadata available</div>`;
}

export function buildQuoteTooltip(meta: QuoteMeta): string {
  const parts: string[] = [];
  if (meta.citedText) {
    parts.push(`<div class="tt-quote">“${escapeHtml(meta.citedText)}”</div>`);
  }
  const src = meta.sourceTitle;
  const creator = meta.sourceCreator;
  const year = meta.sourceYear;
  const byline = [src, creator && year ? `${creator} (${year})` : creator || (year ? `(${year})` : '')]
    .filter(Boolean).join(' — ');
  if (byline) parts.push(`<div class="tt-byline">— ${escapeHtml(byline)}</div>`);
  const loc = meta.pageRange ? `pp. ${meta.pageRange}`
    : meta.page ? `p. ${meta.page}`
    : meta.locationText ? meta.locationText
    : '';
  if (loc) parts.push(`<div class="tt-meta">${escapeHtml(loc)}</div>`);
  return parts.join('') || `<div class="tt-meta">No excerpt metadata available</div>`;
}

export function formatFullByline(creators: string[], year?: string): string {
  const who = creators.length === 0 ? ''
    : creators.length <= 3 ? creators.join(', ')
    : `${creators.slice(0, 3).join(', ')}, …`;
  if (who && year) return `${who} · ${year}`;
  return who || (year ?? '');
}
