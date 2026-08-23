/**
 * Source queries (#1838 — split by family out of `queries.ts`).
 *
 * Everything that answers a question about a SOURCE: the full detail record
 * the Source viewer renders (metadata, excerpts, backlinks, about-notes,
 * references), the reading queue, the per-note citation aggregation, and the
 * excerpt→source lookup.
 *
 * Self-contained: the whole family reaches only `../state`, and its nine
 * private helpers are used nowhere else. `listAllSources` comes along from
 * further up the old file — it sat among the tag queries but calls
 * `collectSourceMetadata`, so this is where it belonged all along.
 *
 * Read-only, and re-exported by `queries.ts`, so every existing importer is
 * unchanged.
 */
import * as $rdf from 'rdflib';
import type { ProjectContext } from '../../project-context-types';
import type {
  SourceDetail, SourceMetadata, SourceExcerpt, SourceBacklink, SourceAboutNote,
  SourceReference, ReadStatus,
} from '../../../shared/types';
import {
  type GraphState,
  getState,
  MINERVA, DC, RDF, BIBO, THOUGHT,
  noteUri, sourceUri, excerptUri,
} from '../state';

/**
 * List every indexed source with its display metadata, sorted by title.
 * Used by the sidebar's Sources panel for navigation.
 */
export function listAllSources(ctx: ProjectContext): SourceMetadata[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const entries: SourceMetadata[] = [];
  const seen = new Set<string>();
  const idStmts = store.statementsMatching(undefined, MINERVA('sourceId'), undefined);
  for (const st of idStmts) {
    const sourceId = st.object.value;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    entries.push(collectSourceMetadata(state, sourceId, st.subject as $rdf.NamedNode));
  }
  entries.sort((a, b) => {
    const ta = (a.title ?? a.sourceId).toLowerCase();
    const tb = (b.title ?? b.sourceId).toLowerCase();
    return ta.localeCompare(tb);
  });
  return entries;
}

const READ_STATUS_VALUES: ReadonlySet<ReadStatus> = new Set(['unread', 'reading', 'read', 'skipped']);

export function getSourceDetail(ctx: ProjectContext, sourceId: string): SourceDetail | null {
  const state = getState(ctx);
  if (!state) return null;
  const { store } = state;

  const subject = sourceUri(state, sourceId);
  // Probe for existence via sourceId triple (which indexSource always writes).
  const exists = store.statementsMatching(subject, MINERVA('sourceId'), undefined).length > 0;
  if (!exists) return null;

  const metadata = collectSourceMetadata(state, sourceId, subject);
  const excerpts = collectExcerptsForSource(state, subject);
  const backlinks = collectSourceBacklinks(state, subject, excerpts);
  const aboutNotes = collectSourceAboutNotes(state, subject);
  const references = collectSourceReferences(state, subject);

  return { metadata, excerpts, backlinks, aboutNotes, references };
}

/**
 * Outgoing `minerva:references` edges from this source (#106) —
 * the bibliography stubs created by reference mining.
 */
function collectSourceReferences(state: GraphState, sourceSubject: $rdf.NamedNode): SourceReference[] {
  const { store } = state;
  const out: SourceReference[] = [];
  const seen = new Set<string>();
  for (const st of store.statementsMatching(sourceSubject, MINERVA('references'), undefined)) {
    const targetSubject = st.object as $rdf.NamedNode;
    const idStmts = store.statementsMatching(targetSubject, MINERVA('sourceId'), undefined);
    const targetId = idStmts[0]?.object.value;
    if (!targetId || seen.has(targetId)) continue;
    seen.add(targetId);
    const titleStmts = store.statementsMatching(targetSubject, DC('title'), undefined);
    const stubStmts = store.statementsMatching(targetSubject, THOUGHT('stubStatus'), undefined);
    out.push({
      sourceId: targetId,
      title: titleStmts[0]?.object.value ?? targetId,
      stubStatus: stubStmts[0]?.object.value ?? null,
    });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * First object value for (subject, pred) in the store, or null — collapses the
 * `store.statementsMatching(s, p)[0]?.object.value ?? null` idiom that recurs
 * across these RDF extractors (#1607).
 */
function firstObjectValue(
  store: $rdf.IndexedFormula,
  subject: $rdf.NamedNode,
  pred: ReturnType<typeof MINERVA>,
): string | null {
  return store.statementsMatching(subject, pred, undefined)[0]?.object.value ?? null;
}

function collectSourceMetadata(state: GraphState, sourceId: string, subject: $rdf.NamedNode): SourceMetadata {
  const { store } = state;

  // Pick the most specific thought:* type we recognize (not the generic Source).
  let subtype: string | null = null;
  const typeStmts = store.statementsMatching(subject, RDF('type'), undefined);
  for (const st of typeStmts) {
    const val = st.object.value;
    if (!val.startsWith(THOUGHT('').value)) continue;
    const local = val.slice(THOUGHT('').value.length);
    if (local === 'Source' || local === 'Component') continue;
    subtype = local;
    break;
  }

  const creators: string[] = [];
  for (const st of store.statementsMatching(subject, DC('creator'), undefined)) {
    const v = st.object.value;
    if (!creators.includes(v)) creators.push(v);
  }

  const first = (pred: ReturnType<typeof MINERVA>): string | null => firstObjectValue(store, subject, pred);

  const issued = first(DC('issued'));
  const rawReadStatus = first(MINERVA('readStatus'));
  const readStatus = rawReadStatus && READ_STATUS_VALUES.has(rawReadStatus as ReadStatus)
    ? rawReadStatus as ReadStatus
    : null;

  // Tag names: resolve each hasTag edge to its tagName literal (falling back
  // to the URI tail). Deduped + sorted for a stable display order.
  const tags: string[] = [];
  for (const st of store.statementsMatching(subject, MINERVA('hasTag'), undefined)) {
    const tagNode = st.object as $rdf.NamedNode;
    const nameStmts = store.statementsMatching(tagNode, MINERVA('tagName'), undefined);
    const name = nameStmts[0]?.object.value ?? tagNode.value;
    if (name && !tags.includes(name)) tags.push(name);
  }
  tags.sort((a, b) => a.localeCompare(b));

  return {
    sourceId,
    subtype,
    title: first(DC('title')),
    creators,
    year: issued ? issued.slice(0, 4) : null,
    publisher: first(DC('publisher')),
    doi: first(BIBO('doi')),
    uri: first(BIBO('uri')),
    abstract: first(DC('abstract')),
    readStatus,
    readDueBy: first(MINERVA('readDueBy')),
    stubStatus: first(THOUGHT('stubStatus')),
    tags,
  };
}

/**
 * Built-in Reading Queue views (#116). Each view resolves to a set
 * of sourceIds via a hardcoded predicate evaluated against the live
 * graph — distinct from user-defined smart collections which can't
 * (yet) express date-relative facets.
 */
export type ReadingQueueView = 'unread' | 'reading' | 'dueThisWeek' | 'recentlyFinished';

export const DAY_MS = 86_400_000;

/**
 * Source ids matching the given queue view. `now` is injectable for
 * deterministic tests; production callers pass nothing and get the
 * current wall clock.
 *
 *   unread           — readStatus is unset OR explicitly 'unread'
 *   reading          — readStatus = 'reading'
 *   dueThisWeek      — readDueBy is set AND ≤ now + 7 days (past-due included)
 *   recentlyFinished — readStatus = 'read' AND dc:modified within last 30 days
 */
export function getReadingQueueSourceIds(
  ctx: ProjectContext,
  view: ReadingQueueView,
  now: Date = new Date(),
): string[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  // Walk every source. Project sizes are O(1000), so a single pass
  // beats running multiple statementsMatching queries.
  const sourceStmts = store.statementsMatching(undefined, MINERVA('sourceId'), undefined);
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const st of sourceStmts) {
    const subject = st.subject;
    const sourceId = st.object.value;
    if (!sourceId || seen.has(sourceId)) continue;

    const status = store.statementsMatching(subject, MINERVA('readStatus'), undefined)[0]?.object.value ?? null;

    if (view === 'unread') {
      if (status === null || status === 'unread') {
        seen.add(sourceId); matched.push(sourceId);
      }
      continue;
    }
    if (view === 'reading') {
      if (status === 'reading') {
        seen.add(sourceId); matched.push(sourceId);
      }
      continue;
    }
    if (view === 'dueThisWeek') {
      const due = store.statementsMatching(subject, MINERVA('readDueBy'), undefined)[0]?.object.value;
      if (!due) continue;
      const dueMs = Date.parse(due);
      if (Number.isNaN(dueMs)) continue;
      if (dueMs <= now.getTime() + 7 * DAY_MS) {
        seen.add(sourceId); matched.push(sourceId);
      }
      continue;
    }
    if (view === 'recentlyFinished') {
      if (status !== 'read') continue;
      const modified = store.statementsMatching(subject, DC('modified'), undefined)[0]?.object.value;
      if (!modified) continue;
      const mMs = Date.parse(modified);
      if (Number.isNaN(mMs)) continue;
      if (mMs >= now.getTime() - 30 * DAY_MS) {
        seen.add(sourceId); matched.push(sourceId);
      }
      continue;
    }
    // Exhaustiveness — tells future contributors when they extend the union.
    const _exhaustive: never = view;
    throw new Error(`Unknown queue view: ${String(_exhaustive)}`);
  }
  return matched;
}

/**
 * Sources tagged with a particular reading status (#116). Used by
 * the smart-collection resolver and by sidebar filters that surface
 * "Unread" / "Reading" / "Read" buckets.
 */
export function sourcesByReadStatus(ctx: ProjectContext, status: ReadStatus): { sourceId: string }[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;

  const stmts = store.statementsMatching(undefined, MINERVA('readStatus'), $rdf.lit(status));
  const out: { sourceId: string }[] = [];
  const seen = new Set<string>();
  for (const st of stmts) {
    const idStmts = store.statementsMatching(st.subject, MINERVA('sourceId'), undefined);
    const sourceId = idStmts[0]?.object.value;
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId });
  }
  return out;
}

function collectExcerptsForSource(state: GraphState, sourceSubject: $rdf.NamedNode): SourceExcerpt[] {
  const { store } = state;

  const excerpts: SourceExcerpt[] = [];
  const seen = new Set<string>();
  const stmts = store.statementsMatching(undefined, THOUGHT('fromSource'), sourceSubject);
  for (const st of stmts) {
    const ex = st.subject as $rdf.NamedNode;
    const idStmts = store.statementsMatching(ex, MINERVA('excerptId'), undefined);
    const id = idStmts[0]?.object.value;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const first = (pred: ReturnType<typeof MINERVA>): string | null => firstObjectValue(store, ex, pred);

    excerpts.push({
      excerptId: id,
      citedText: first(THOUGHT('citedText')),
      page: first(THOUGHT('page')),
      pageRange: first(THOUGHT('pageRange')),
      locationText: first(THOUGHT('locationText')),
    });
  }
  excerpts.sort((a, b) => a.excerptId.localeCompare(b.excerptId));
  return excerpts;
}

function collectSourceBacklinks(
  state: GraphState,
  sourceSubject: $rdf.NamedNode,
  excerpts: SourceExcerpt[],
): SourceBacklink[] {
  const { store } = state;

  const results: SourceBacklink[] = [];
  const seen = new Set<string>();

  const pushBacklink = (noteSubject: $rdf.NamedNode, kind: 'cite' | 'quote', viaExcerptId?: string) => {
    const pathStmts = store.statementsMatching(noteSubject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value;
    if (!relativePath) return;
    const key = `${kind}::${relativePath}::${viaExcerptId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const titleStmts = store.statementsMatching(noteSubject, DC('title'), undefined);
    results.push({
      relativePath,
      title: titleStmts[0]?.object.value ?? relativePath,
      kind,
      ...(viaExcerptId !== undefined ? { viaExcerptId } : {}),
    });
  };

  // Direct cites
  for (const st of store.statementsMatching(undefined, THOUGHT('cites'), sourceSubject)) {
    pushBacklink(st.subject as $rdf.NamedNode, 'cite');
  }

  // Quotes of excerpts that belong to this source
  for (const ex of excerpts) {
    const exNode = excerptUri(state, ex.excerptId);
    for (const st of store.statementsMatching(undefined, THOUGHT('quotes'), exNode)) {
      pushBacklink(st.subject as $rdf.NamedNode, 'quote', ex.excerptId);
    }
  }

  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
}

/**
 * Notes whose frontmatter declares them as *about* this source (#474).
 * Driven by `dc:subject` edges from a Minerva note to the source URI —
 * the frontmatter resolver materialises `about: [[sources/<id>]]` into
 * exactly this triple. Distinct from cite/quote backlinks: this is
 * subject-of, not reference-of.
 */
function collectSourceAboutNotes(state: GraphState, sourceSubject: $rdf.NamedNode): SourceAboutNote[] {
  const { store } = state;
  const results: SourceAboutNote[] = [];
  const seen = new Set<string>();
  for (const st of store.statementsMatching(undefined, DC('subject'), sourceSubject)) {
    const subject = st.subject as $rdf.NamedNode;
    // Only count actual notes — a future excerpt or proposal could
    // carry dc:subject too, and the source detail's Notes section is
    // specifically for prose commentary.
    const isNote = store.statementsMatching(subject, RDF('type'), MINERVA('Note')).length > 0;
    if (!isNote) continue;
    const pathStmts = store.statementsMatching(subject, MINERVA('relativePath'), undefined);
    const relativePath = pathStmts[0]?.object.value;
    if (!relativePath || seen.has(relativePath)) continue;
    seen.add(relativePath);
    const titleStmts = store.statementsMatching(subject, DC('title'), undefined);
    results.push({
      relativePath,
      title: titleStmts[0]?.object.value ?? relativePath,
    });
  }
  results.sort((a, b) => a.title.localeCompare(b.title));
  return results;
}

/**
 * Per-source aggregation of every citation a note makes (#111).
 *
 * Walks the indexed `thought:cites` and `thought:quotes` edges from
 * the note. The graph stores at most one edge per (note, predicate,
 * target) pair regardless of how many times the citation appears
 * inline, so we re-scan the note's content to derive *occurrence
 * counts* — that's the bit users actually want when they're seeing
 * "this source is referenced 4 times in this note." The graph drives
 * the source set, the content drives the count.
 */
/** Occurrence-map key for an inline citation/quote — `cite:<sourceId>` or
 *  `quote:<excerptId>` (#1609). */
function citationOccurrenceKey(kind: string, id: string): string {
  return `${kind.toLowerCase()}:${id}`;
}

/**
 * Count inline `[[cite::id]]` / `[[quote::ex]]` occurrences in note content,
 * keyed by {@link citationOccurrenceKey}. Uses the same typed-link regex as the
 * editor's decoration rules so anything the user sees as a citation is counted,
 * and strips bibliography-block content (#113) so its rendered entries don't
 * re-inflate the count for sources that no longer have inline cites.
 */
function countCitationOccurrences(content: string): Map<string, number> {
  const countable = content.replace(
    /<!-- minerva:bibliography -->[\s\S]*?<!-- \/minerva:bibliography -->/g,
    '',
  );
  const occurrences = new Map<string, number>();
  const RE = /\[\[(cite|quote)::([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(countable)) !== null) {
    const key = citationOccurrenceKey(m[1]!, m[2]!.trim());
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  return occurrences;
}

/**
 * The set of source nodes a note references — the union of its `thought:cites`
 * edges and the owning sources of its `thought:quotes` excerpts. Keyed by URI
 * string because rdflib hands back fresh NamedNode instances per call, so a JS
 * Set on the node would treat them as distinct (#1609).
 */
function buildCitedSourceSet(
  store: $rdf.IndexedFormula,
  noteSubject: $rdf.NamedNode,
): Map<string, $rdf.NamedNode> {
  const sourceUris = new Map<string, $rdf.NamedNode>();
  for (const st of store.statementsMatching(noteSubject, THOUGHT('cites'), undefined)) {
    const node = st.object as $rdf.NamedNode;
    sourceUris.set(node.value, node);
  }
  // Quote edges → owning source. An excerpt without a fromSource link is
  // malformed ingest output; skip silently rather than surfacing a half-row.
  for (const st of store.statementsMatching(noteSubject, THOUGHT('quotes'), undefined)) {
    const excerptNode = st.object as $rdf.NamedNode;
    const fromStmts = store.statementsMatching(excerptNode, THOUGHT('fromSource'), undefined);
    const sourceNode = fromStmts[0]?.object as $rdf.NamedNode | undefined;
    if (!sourceNode) continue;
    sourceUris.set(sourceNode.value, sourceNode);
  }
  return sourceUris;
}

export function citationsForNote(
  ctx: ProjectContext,
  relativePath: string,
  content: string,
): import('../../../shared/types').CitationGroup[] {
  const state = getState(ctx);
  if (!state) return [];
  const { store } = state;
  const noteSubject = noteUri(state, relativePath);

  const sourceUris = buildCitedSourceSet(store, noteSubject);
  const occurrences = countCitationOccurrences(content);

  const groups: import('../../../shared/types').CitationGroup[] = [];
  for (const sourceNode of sourceUris.values()) {
    const idStmts = store.statementsMatching(sourceNode, MINERVA('sourceId'), undefined);
    const sourceId = idStmts[0]?.object.value;
    if (!sourceId) continue;
    const meta = collectSourceMetadata(state, sourceId, sourceNode);

    // Cites: occurrences keyed by the source id directly.
    const citeCount = occurrences.get(citationOccurrenceKey('cite', sourceId)) ?? 0;

    // Quotes: walk every excerpt whose fromSource is this source AND
    // whose id appears in the note. Per-excerpt count comes from the
    // occurrence map.
    const allExcerpts = collectExcerptsForSource(state, sourceNode);
    const noteExcerpts: (import('../../../shared/types').SourceExcerpt & { quoteCount: number })[] = [];
    let totalQuoteCount = 0;
    for (const ex of allExcerpts) {
      const c = occurrences.get(citationOccurrenceKey('quote', ex.excerptId)) ?? 0;
      if (c === 0) continue;
      noteExcerpts.push({ ...ex, quoteCount: c });
      totalQuoteCount += c;
    }

    // A source ends up in the result set when EITHER it's directly
    // cited or one of its excerpts is quoted. If both counts are zero,
    // the graph thinks the note references it but the content doesn't —
    // possible during transient indexer/disk skew. Skip silently.
    if (citeCount === 0 && totalQuoteCount === 0) continue;

    groups.push({
      sourceId,
      title: meta.title,
      year: meta.year,
      creators: meta.creators,
      citeCount,
      quoteCount: totalQuoteCount,
      excerpts: noteExcerpts,
    });
  }

  // Stable, useful order: most-cited first, then alpha by title for
  // ties. "Most-cited first" matches the user's mental model of
  // skimming a paper — the heavy hitters at the top.
  groups.sort((a, b) => {
    const totalA = a.citeCount + a.quoteCount;
    const totalB = b.citeCount + b.quoteCount;
    if (totalA !== totalB) return totalB - totalA;
    const ta = (a.title ?? a.sourceId).toLowerCase();
    const tb = (b.title ?? b.sourceId).toLowerCase();
    return ta.localeCompare(tb);
  });
  return groups;
}

/** Resolve an excerpt-id to the sourceId of its fromSource, or null if not found. */
export function getExcerptSource(ctx: ProjectContext, excerptId: string): { sourceId: string } | null {
  const state = getState(ctx);
  if (!state) return null;
  const { store } = state;
  const ex = excerptUri(state, excerptId);
  const stmts = store.statementsMatching(ex, THOUGHT('fromSource'), undefined);
  const sourceNode = stmts[0]?.object as $rdf.NamedNode | undefined;
  if (!sourceNode) return null;
  const idStmts = store.statementsMatching(sourceNode, MINERVA('sourceId'), undefined);
  const id = idStmts[0]?.object.value;
  return id ? { sourceId: id } : null;
}
