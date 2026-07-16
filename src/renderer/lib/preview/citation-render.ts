// Citation / quote rendering for the note preview (#110), split out of
// Preview.svelte (#1087). These are the DOM-orchestration functions that enrich
// already-rendered `.cite-link` / `.quote-link` elements: a batch CSL-marker
// pass over the whole preview, plus per-element metadata resolution for the
// hover tooltip. Pure builders + types live in `./cite-meta`; this is the glue
// that queries the graph and mutates the DOM.

import { api } from '../ipc/client';
import { collapseCiteRows, type CiteMeta, type QuoteMeta } from './cite-meta';

export interface CitationRenderDeps {
  /** The rendered-preview root to query links within. */
  previewEl: HTMLElement | undefined;
  /** sourceId → resolved cite metadata; survives re-renders (reset on note switch). */
  citeMetaCache: Map<string, CiteMeta>;
  /** excerptId → resolved quote metadata; survives re-renders. */
  quoteMetaCache: Map<string, QuoteMeta>;
  /** Standard SPARQL prefixes prepended to each query. */
  queryPrefixes: string;
  /** Set the numeric-style preview bibliography (or null to clear). */
  setBibliographyEntries: (entries: string[] | null) => void;
}

/**
 * Walk every cite/quote link in document order, batch them into one IPC call,
 * and swap each link's `.link-display` text for the citeproc-rendered marker.
 * Document order matters for numeric styles ("[1]" goes to the first-cited
 * item) — `querySelectorAll` returns DOM-order, which equals source-order here.
 */
export async function applyCslMarkers(deps: CitationRenderDeps): Promise<void> {
  const root = deps.previewEl;
  if (!root) return;
  const links = Array.from(
    root.querySelectorAll<HTMLElement>('.cite-link, .quote-link'),
  );
  if (links.length === 0) {
    deps.setBibliographyEntries(null);
    return;
  }
  const refs: { kind: 'cite' | 'quote'; id: string }[] = [];
  for (const el of links) {
    if (el.classList.contains('cite-link')) {
      const id = el.dataset.sourceId;
      if (id) refs.push({ kind: 'cite', id });
    } else {
      const id = el.dataset.excerptId;
      if (id) refs.push({ kind: 'quote', id });
    }
  }
  if (refs.length === 0) {
    deps.setBibliographyEntries(null);
    return;
  }
  let response: Awaited<ReturnType<typeof api.citations.renderInline>>;
  try {
    response = await api.citations.renderInline(refs);
  } catch (err) {
    console.warn('[preview] citation render failed:', err);
    deps.setBibliographyEntries(null);
    return;
  }
  // The DOM may have re-rendered while the IPC was in flight; bail if the link
  // set we measured is no longer current.
  const currentLinks = root.querySelectorAll<HTMLElement>('.cite-link, .quote-link');
  if (currentLinks.length !== links.length) return;
  for (let i = 0; i < links.length; i++) {
    const el = links[i]!;
    const marker = response.markers[i];
    if (typeof marker !== 'string') continue;
    // Respect the user's |display override — they asked for that exact text and
    // citeproc shouldn't override it.
    if (el.dataset.displayOverride === '1') continue;
    const displayEl = el.querySelector<HTMLSpanElement>('.link-display');
    if (!displayEl) continue;
    displayEl.innerHTML = marker;
  }
  deps.setBibliographyEntries(response.bibliography);
}

/**
 * Resolve hover-tooltip metadata for a whole batch of `.cite-link` elements in
 * ONE IPC round-trip (perf #1114). The former per-element resolver issued a
 * separate `api.graph.query` for each link, so a citation-heavy note fired N
 * SPARQL round-trips on every re-render. Cached ids are applied immediately; the
 * uncached remainder is fetched with a single `VALUES ?sid { … }` query, grouped
 * back per source, and cached. On query failure the uncached links are left as
 * their rendered source-id, retried on the next render (matching the old
 * per-element fall-through).
 */
export async function resolveCiteLabels(deps: CitationRenderDeps, els: HTMLElement[]): Promise<void> {
  const uncached = new Map<string, HTMLElement[]>();
  for (const el of els) {
    const id = el.dataset.sourceId;
    if (!id || !el.querySelector('.link-display')) continue;
    const cached = deps.citeMetaCache.get(id);
    if (cached) { applyCiteMeta(el, cached); continue; }
    const group = uncached.get(id);
    if (group) group.push(el); else uncached.set(id, [el]);
  }
  if (uncached.size === 0) return;

  const values = [...uncached.keys()].map((id) => `"${id.replace(/"/g, '\\"')}"`).join(' ');
  const sparql = `PREFIX bibo: <http://purl.org/ontology/bibo/>
      SELECT ?sid ?title ?creator ?issued ?doi ?uri WHERE {
        VALUES ?sid { ${values} }
        ?src minerva:sourceId ?sid .
        OPTIONAL { ?src dc:title ?title }
        OPTIONAL { ?src dc:creator ?creator }
        OPTIONAL { ?src dc:issued ?issued }
        OPTIONAL { ?src bibo:doi ?doi }
        OPTIONAL { ?src bibo:uri ?uri }
      }`;
  let rows: Array<Record<string, string>>;
  try {
    const response = await api.graph.query(deps.queryPrefixes + sparql);
    rows = response.results as Array<Record<string, string>>;
  } catch {
    return; // leave uncached links as-is; next render retries.
  }

  // Group rows by source id — a source with multiple creators yields one row
  // each, and `collapseCiteRows` folds them into a single CiteMeta.
  const rowsById = new Map<string, Array<Record<string, string>>>();
  for (const row of rows) {
    const sid = row.sid;
    if (sid == null) continue;
    const group = rowsById.get(sid);
    if (group) group.push(row); else rowsById.set(sid, [row]);
  }
  for (const [id, targets] of uncached) {
    const meta = collapseCiteRows(rowsById.get(id) ?? []);
    deps.citeMetaCache.set(id, meta);
    for (const el of targets) applyCiteMeta(el, meta);
  }
}

function applyCiteMeta(el: HTMLElement, meta: CiteMeta): void {
  // Display text is owned by the CSL marker pass (#110); we only populate
  // tooltip metadata here.
  el.dataset.tooltipKind = 'cite';
  el.dataset.tooltipPayload = JSON.stringify(meta);
}

/** Build a QuoteMeta from one SPARQL result row (excerpt + owning source). */
function quoteMetaFromRow(row: Record<string, string> | undefined): QuoteMeta {
  return row ? {
    ...(row.citedText !== undefined ? { citedText: row.citedText } : {}),
    ...(row.sourceTitle !== undefined ? { sourceTitle: row.sourceTitle } : {}),
    ...(row.sourceCreator !== undefined ? { sourceCreator: row.sourceCreator } : {}),
    ...(row.sourceIssued !== undefined ? { sourceYear: row.sourceIssued.slice(0, 4) } : {}),
    ...(row.page !== undefined ? { page: row.page } : {}),
    ...(row.pageRange !== undefined ? { pageRange: row.pageRange } : {}),
    ...(row.locationText !== undefined ? { locationText: row.locationText } : {}),
  } : {};
}

/**
 * Batched counterpart to `resolveCiteLabels` for `.quote-link` elements (perf
 * #1114): resolve every uncached excerpt's tooltip metadata in ONE IPC round-
 * trip via `VALUES ?eid { … }` instead of one query per link. First row per
 * excerpt wins (mirrors the old `LIMIT 1`).
 */
export async function resolveQuoteLabels(deps: CitationRenderDeps, els: HTMLElement[]): Promise<void> {
  const uncached = new Map<string, HTMLElement[]>();
  for (const el of els) {
    const id = el.dataset.excerptId;
    if (!id || !el.querySelector('.link-display')) continue;
    const cached = deps.quoteMetaCache.get(id);
    if (cached) { applyQuoteMeta(el, cached); continue; }
    const group = uncached.get(id);
    if (group) group.push(el); else uncached.set(id, [el]);
  }
  if (uncached.size === 0) return;

  const values = [...uncached.keys()].map((id) => `"${id.replace(/"/g, '\\"')}"`).join(' ');
  const sparql = `SELECT ?eid ?citedText ?sourceTitle ?sourceCreator ?sourceIssued ?page ?pageRange ?locationText WHERE {
      VALUES ?eid { ${values} }
      ?ex minerva:excerptId ?eid .
      OPTIONAL { ?ex thought:citedText ?citedText }
      OPTIONAL { ?ex thought:page ?page }
      OPTIONAL { ?ex thought:pageRange ?pageRange }
      OPTIONAL { ?ex thought:locationText ?locationText }
      OPTIONAL {
        ?ex thought:fromSource ?src .
        OPTIONAL { ?src dc:title ?sourceTitle }
        OPTIONAL { ?src dc:creator ?sourceCreator }
        OPTIONAL { ?src dc:issued ?sourceIssued }
      }
    }`;
  let rows: Array<Record<string, string>>;
  try {
    const response = await api.graph.query(deps.queryPrefixes + sparql);
    rows = response.results as Array<Record<string, string>>;
  } catch {
    return; // leave uncached links as-is; next render retries.
  }

  // Keep the first row per excerpt id (old behavior: LIMIT 1).
  const rowById = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const eid = row.eid;
    if (eid != null && !rowById.has(eid)) rowById.set(eid, row);
  }
  for (const [id, targets] of uncached) {
    const meta = quoteMetaFromRow(rowById.get(id));
    deps.quoteMetaCache.set(id, meta);
    for (const el of targets) applyQuoteMeta(el, meta);
  }
}

/**
 * One-shot post-render enrichment for every cite + quote link in the preview
 * (perf #1114). Replaces the former per-element `forEach(resolveCiteLabel)` /
 * `forEach(resolveQuoteLabel)` fan-out with two batched queries (cites, quotes)
 * that run concurrently.
 */
export async function resolveCiteQuoteLabels(deps: CitationRenderDeps): Promise<void> {
  const root = deps.previewEl;
  if (!root) return;
  const cites = Array.from(root.querySelectorAll<HTMLElement>('.cite-link'));
  const quotes = Array.from(root.querySelectorAll<HTMLElement>('.quote-link'));
  await Promise.all([
    resolveCiteLabels(deps, cites),
    resolveQuoteLabels(deps, quotes),
  ]);
}

function applyQuoteMeta(el: HTMLElement, meta: QuoteMeta): void {
  // Display text is owned by the CSL marker pass (#110); we only populate
  // tooltip metadata here.
  el.dataset.tooltipKind = 'quote';
  el.dataset.tooltipPayload = JSON.stringify(meta);
}
