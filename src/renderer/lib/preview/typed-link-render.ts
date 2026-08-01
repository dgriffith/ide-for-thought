/**
 * Type-keyed link-card post-render pass (#1071). Runs after the preview paints
 * (fire-and-forget, off the critical path), promoting a *block-level* wiki-link
 * — one that's alone in its paragraph — to a rich card keyed off the target's
 * type: a typed note → an object card (cover + fields); a `[[quote::id]]` →
 * an excerpt card (span + source + locator). Inline links mid-prose are left
 * exactly as today, so untyped/ordinary links never regress.
 *
 * Modeled on citation-render.ts: cached, stale-DOM-guarded (a node dropped by a
 * re-render mid-fetch is skipped), and injecting escaped-string HTML.
 */
import { api } from '../ipc/client';
import type { NoteTypedProperties } from '../../../shared/objects/type-def';
import type { QuoteMeta } from './cite-meta';
import { buildObjectCardHtml, buildExcerptCardHtml, isBlockLevelLink } from './typed-card';

export interface TypedCardDeps {
  previewEl: HTMLElement | null;
  /** path → typed properties, surviving re-renders; cleared on `revision`. */
  typePropsCache: Map<string, NoteTypedProperties>;
  /** id → excerpt metadata, shared with the cite/quote label pass. */
  quoteMetaCache: Map<string, QuoteMeta>;
  queryPrefixes: string;
  /** Resolve a raw wiki-link target to a project-relative path (or null). */
  resolvePath: (target: string) => string | null;
}

async function fetchTypedProps(deps: TypedCardDeps, path: string): Promise<NoteTypedProperties> {
  const cached = deps.typePropsCache.get(path);
  if (cached) return cached;
  const rb = await api.types.noteProperties(path);
  deps.typePropsCache.set(path, rb);
  return rb;
}

/** One excerpt's card metadata — cached (shared with the quote-label pass), else
 *  a single-id graph read mirroring resolveQuoteLabels' projection. */
async function fetchQuoteMeta(deps: TypedCardDeps, id: string): Promise<QuoteMeta | null> {
  const cached = deps.quoteMetaCache.get(id);
  if (cached) return cached;
  const sparql = `SELECT ?citedText ?sourceTitle ?sourceCreator ?sourceIssued ?page ?pageRange ?locationText WHERE {
      ?ex minerva:excerptId "${id.replace(/"/g, '\\"')}" .
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
  let row: Record<string, string> | undefined;
  try {
    const res = await api.graph.query(deps.queryPrefixes + sparql);
    row = (res.results as Array<Record<string, string>>)[0];
  } catch {
    return null;
  }
  if (!row) return null;
  const meta: QuoteMeta = {
    ...(row.citedText ? { citedText: row.citedText } : {}),
    ...(row.sourceTitle ? { sourceTitle: row.sourceTitle } : {}),
    ...(row.sourceCreator ? { sourceCreator: row.sourceCreator } : {}),
    ...(row.sourceIssued ? { sourceYear: row.sourceIssued.slice(0, 4) } : {}),
    ...(row.page ? { page: row.page } : {}),
    ...(row.pageRange ? { pageRange: row.pageRange } : {}),
    ...(row.locationText ? { locationText: row.locationText } : {}),
  };
  deps.quoteMetaCache.set(id, meta);
  return meta;
}

export async function hydrateTypedCards(deps: TypedCardDeps): Promise<void> {
  const el = deps.previewEl;
  if (!el) return;

  // Typed-note cards — plain `[[Note]]` links only (`.wiki-link` without the
  // `typed-link` badge class that cite/quote/type:: links carry).
  const noteLinks = [...el.querySelectorAll<HTMLElement>('.wiki-link:not(.typed-link)')].filter(
    (a) => a.dataset.typedCard === undefined && isBlockLevelLink(a),
  );
  for (const a of noteLinks) {
    const target = a.dataset.target;
    if (!target) continue;
    const path = deps.resolvePath(target);
    if (!path) continue;
    const rb = await fetchTypedProps(deps, path);
    if (!a.isConnected) continue; // preview re-rendered mid-fetch
    if (!rb.type) continue; // untyped → leave the bare link
    a.dataset.typedCard = '1';
    a.classList.add('object-card');
    a.innerHTML = buildObjectCardHtml(rb, { title: (a.textContent ?? target).trim() });
  }

  // Excerpt cards — block-level `[[quote::id]]` links.
  const quoteLinks = [...el.querySelectorAll<HTMLElement>('.quote-link')].filter(
    (a) => a.dataset.typedCard === undefined && isBlockLevelLink(a),
  );
  for (const a of quoteLinks) {
    const id = a.dataset.excerptId;
    if (!id) continue;
    const meta = await fetchQuoteMeta(deps, id);
    if (!a.isConnected || !meta) continue;
    a.dataset.typedCard = '1';
    a.classList.add('excerpt-card');
    a.innerHTML = buildExcerptCardHtml(meta);
  }
}
