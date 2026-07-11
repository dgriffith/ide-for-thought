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

export async function resolveCiteLabel(deps: CitationRenderDeps, el: HTMLElement): Promise<void> {
  const sourceId = el.dataset.sourceId;
  if (!sourceId) return;

  const displayEl = el.querySelector<HTMLSpanElement>('.link-display');
  if (!displayEl) return;

  const cached = deps.citeMetaCache.get(sourceId);
  if (cached) {
    applyCiteMeta(el, cached);
    return;
  }

  try {
    const idEsc = sourceId.replace(/"/g, '\\"');
    const sparql = `PREFIX bibo: <http://purl.org/ontology/bibo/>
        SELECT ?title ?creator ?issued ?doi ?uri WHERE {
          ?src minerva:sourceId "${idEsc}" .
          OPTIONAL { ?src dc:title ?title }
          OPTIONAL { ?src dc:creator ?creator }
          OPTIONAL { ?src dc:issued ?issued }
          OPTIONAL { ?src bibo:doi ?doi }
          OPTIONAL { ?src bibo:uri ?uri }
        }`;
    const response = await api.graph.query(deps.queryPrefixes + sparql);
    const meta = collapseCiteRows(response.results as Array<Record<string, string>>);
    deps.citeMetaCache.set(sourceId, meta);
    applyCiteMeta(el, meta);
  } catch {
    // Fall back to the source-id already rendered.
  }
}

function applyCiteMeta(el: HTMLElement, meta: CiteMeta): void {
  // Display text is owned by the CSL marker pass (#110); we only populate
  // tooltip metadata here.
  el.dataset.tooltipKind = 'cite';
  el.dataset.tooltipPayload = JSON.stringify(meta);
}

export async function resolveQuoteLabel(deps: CitationRenderDeps, el: HTMLElement): Promise<void> {
  const excerptId = el.dataset.excerptId;
  if (!excerptId) return;

  const displayEl = el.querySelector<HTMLSpanElement>('.link-display');
  if (!displayEl) return;

  const cached = deps.quoteMetaCache.get(excerptId);
  if (cached) {
    applyQuoteMeta(el, cached);
    return;
  }

  try {
    const idEsc = excerptId.replace(/"/g, '\\"');
    const sparql = `SELECT ?citedText ?sourceTitle ?sourceCreator ?sourceIssued ?page ?pageRange ?locationText WHERE {
        ?ex minerva:excerptId "${idEsc}" .
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
      } LIMIT 1`;
    const response = await api.graph.query(deps.queryPrefixes + sparql);
    const row = response.results[0] as Record<string, string> | undefined;
    const meta: QuoteMeta = row ? {
      ...(row.citedText !== undefined ? { citedText: row.citedText } : {}),
      ...(row.sourceTitle !== undefined ? { sourceTitle: row.sourceTitle } : {}),
      ...(row.sourceCreator !== undefined ? { sourceCreator: row.sourceCreator } : {}),
      ...(row.sourceIssued !== undefined ? { sourceYear: row.sourceIssued.slice(0, 4) } : {}),
      ...(row.page !== undefined ? { page: row.page } : {}),
      ...(row.pageRange !== undefined ? { pageRange: row.pageRange } : {}),
      ...(row.locationText !== undefined ? { locationText: row.locationText } : {}),
    } : {};
    deps.quoteMetaCache.set(excerptId, meta);
    applyQuoteMeta(el, meta);
  } catch {
    // Fall back to the excerpt-id already rendered.
  }
}

function applyQuoteMeta(el: HTMLElement, meta: QuoteMeta): void {
  // Display text is owned by the CSL marker pass (#110); we only populate
  // tooltip metadata here.
  el.dataset.tooltipKind = 'quote';
  el.dataset.tooltipPayload = JSON.stringify(meta);
}
