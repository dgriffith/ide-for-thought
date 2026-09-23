/**
 * The five source inspections, over ONE scan of the source table (#2208 C1b).
 *
 * ── Why they moved here, and why they share a query ────────────────────────
 *
 * `runAllChecks` issued ~17 whole-graph SPARQL queries per post-save burst.
 * Six of them were these five checks, and every one opened with the same
 * pattern — `?source minerva:sourceId ?sourceId` — then re-walked the source
 * table to pull one or two more properties off it. Measured at 3,000 notes /
 * 200 sources:
 *
 *   | check                     | before  |
 *   |---------------------------|---------|
 *   | source_cited_unread       |  389ms  |
 *   | source_missing_metadata   |  105ms  |
 *   | source_duplicate_doi/uri  |   44ms  |
 *   | invalid_doi               |   16ms  |
 *   | stub_aged                 |    6ms  |
 *   | **total**                 |**560ms**|
 *
 * against 107ms for one scan that collects every property all five want, plus
 * 25ms for the citation counts — 132ms, in two queries instead of six.
 *
 * The scan is a `UNION` of one branch per property rather than a pile of
 * `OPTIONAL`s, which is not a style preference: `OPTIONAL` binds the
 * cross-product, so a source with five authors and two URLs emits ten rows of
 * mostly-repeated values. Measured, the OPTIONAL form costs 315ms — three
 * times the UNION — and gets worse exactly on the edited volumes and
 * multi-author papers a real library is full of. The UNION form emits one row
 * per triple, which is the honest shape of the data.
 *
 * ── What this deliberately does NOT change ─────────────────────────────────
 *
 * Every selection rule — which sources each check reports, the thresholds, the
 * caps, the "oldest first" and "most-cited first" orderings — is reproduced in
 * JS exactly as the SPARQL stated it. `health-check-findings.test.ts` was
 * written against the old engine and pins that; it is unchanged by this file.
 *
 * Two differences are real and both are dedupes the old queries got wrong, the
 * same class of bug #2309 found in the staleness check. A source carrying two
 * `dc:title` triples produced two rows, hence two identical inspections in the
 * panel; a source carrying two `dc:modified` values (its file mtime and one
 * asserted in `meta.ttl`) did the same. Grouping by source rather than by row
 * reports it once. Tie-breaks that SPARQL left to the engine — which 50
 * incomplete sources, which of two equally-cited sources comes first — are now
 * settled by `sourceId`, so the panel stops reshuffling between runs.
 *
 * ── The cost of sharing ────────────────────────────────────────────────────
 *
 * Switching ONE of the five checks off no longer removes a query; the scan is
 * issued when ANY of them is on, and skipped entirely when none is. That is
 * the right trade at these numbers (the whole scan is a fifth of the cheapest
 * pair it replaces), but it is a real change to what `inspection-settings-
 * skip.test.ts` measures, so it is stated rather than discovered.
 */
import { queryGraph } from './index';
import type { ProjectContext } from '../project-context-types';
import { DAY_MS } from '../../shared/time';
import type { Inspection } from '../../shared/inspections';

/** Duplicate sources check: max results to report for each type (DOI, URI) */
const DUPLICATE_SOURCES_LIMIT = 25;
/** Sources missing bibliographic details: max results to report */
const MISSING_METADATA_LIMIT = 50;
/** Long-unresolved stubs: max results to report */
const AGED_STUB_LIMIT = 50;
/** Cited-but-unread sources: max results to report */
const CITED_UNREAD_LIMIT = 25;

/**
 * Sources carrying a `bibo:doi` literal that doesn't match the Crossref DOI
 * shape (#473). Shape-only check — we don't hit doi.org.
 */
const VALID_DOI_RE = /^10\.\d{4,9}\/[-._;/:a-zA-Z0-9()]+$/;

/** The properties the five checks read, as `key → predicate`. One `UNION`
 *  branch each; adding a check's field here costs no extra round-trip. */
const SOURCE_FIELDS = [
  ['id', 'minerva:sourceId'],
  ['title', 'dc:title'],
  ['creator', 'dc:creator'],
  ['doi', 'bibo:doi'],
  ['uri', 'bibo:uri'],
  ['stub', 'thought:stubStatus'],
  ['read', 'minerva:readStatus'],
  ['modified', 'dc:modified'],
] as const;

type FieldKey = (typeof SOURCE_FIELDS)[number][0];

/** One source, with every value it carries for each field. Multi-valued
 *  throughout because the graph is: two authors, two titles, an mtime and an
 *  asserted `dc:modified` are all ordinary. */
export interface SourceFacts {
  /** The source's node IRI. */
  iri: string;
  values: Record<FieldKey, string[]>;
  /** Distinct notes citing this source. 0 when nothing does. */
  cites: number;
}

/** `minerva:sourceId`, or the IRI when a source somehow carries none. */
function idOf(s: SourceFacts): string {
  return s.values.id[0] ?? s.iri;
}

/** What the panel calls this source: its title if it has one, else its id. */
function labelOf(s: SourceFacts): string {
  return s.values.title[0] ?? idOf(s);
}

function emptyValues(): Record<FieldKey, string[]> {
  return { id: [], title: [], creator: [], doi: [], uri: [], stub: [], read: [], modified: [] };
}

/** Which checks does this run want? Mirrors `isInspectionEnabled`, passed in
 *  so this module doesn't have to know about the settings shape. */
export interface SourceCheckPlan {
  invalidDoi: boolean;
  missingMetadata: boolean;
  agedStub: boolean;
  citedUnread: boolean;
  duplicates: boolean;
  /** Days before an unresolved source stub is called long-unresolved. */
  stubDays: number;
}

/** True when at least one of the five checks is on — i.e. when the shared scan
 *  is worth issuing at all. */
export function anySourceCheckEnabled(plan: SourceCheckPlan): boolean {
  return plan.invalidDoi || plan.missingMetadata || plan.agedStub
    || plan.citedUnread || plan.duplicates;
}

/**
 * One pass over the source table. Returns sources sorted by id, so every
 * check below inherits a deterministic order without sorting again.
 */
async function loadSourceFacts(ctx: ProjectContext, withCites: boolean): Promise<SourceFacts[]> {
  const unions = SOURCE_FIELDS
    .map(([key, predicate]) => `{ ?source ${predicate} ?value . BIND("${key}" AS ?key) }`)
    .join('\n    UNION ');
  // The `minerva:sourceId` guard is what makes this the SOURCE table rather
  // than every node in the graph that happens to have a `dc:title`.
  const rows = await queryGraph(ctx, `
    SELECT ?source ?key ?value WHERE {
      ?source minerva:sourceId ?_sid .
      ${unions}
    }
  `);

  const bySource = new Map<string, SourceFacts>();
  for (const r of rows.results as Array<{ source?: string; key?: FieldKey; value?: string }>) {
    if (!r.source || !r.key || r.value === undefined) continue;
    let facts = bySource.get(r.source);
    if (!facts) {
      facts = { iri: r.source, values: emptyValues(), cites: 0 };
      bySource.set(r.source, facts);
    }
    const bucket = facts.values[r.key];
    // `?value` arrives once per triple; a repeated literal is one triple, so
    // the only way to see a duplicate here is a genuine duplicate assertion.
    if (bucket && !bucket.includes(r.value)) bucket.push(r.value);
  }
  for (const facts of bySource.values()) {
    for (const key of Object.keys(facts.values) as FieldKey[]) facts.values[key].sort();
  }

  if (withCites) {
    // Separate query on purpose: this one joins from the NOTE side, so folding
    // it into the scan above would multiply every property row by every
    // citation. 40 groups out of 3,000 citation triples measured 25ms.
    const counts = await queryGraph(ctx, `
      SELECT ?source (COUNT(DISTINCT ?note) AS ?cites) WHERE {
        ?note thought:cites ?source .
      }
      GROUP BY ?source
    `);
    for (const r of counts.results as Array<{ source?: string; cites?: string }>) {
      const facts = r.source ? bySource.get(r.source) : undefined;
      if (facts) facts.cites = Number(r.cites ?? 0) || 0;
    }
  }

  return [...bySource.values()].sort((a, b) => idOf(a).localeCompare(idOf(b)));
}

// ── The five checks, over the loaded facts ─────────────────────────────────

function invalidDois(sources: SourceFacts[]): Inspection[] {
  const out: Inspection[] = [];
  for (const s of sources) {
    for (const doi of s.values.doi) {
      if (VALID_DOI_RE.test(doi)) continue;
      const label = labelOf(s);
      out.push({
        id: `invalid-doi-${out.length}`,
        type: 'invalid_doi',
        severity: 'warning',
        nodeUri: s.iri,
        nodeLabel: label,
        message: `Source "${label}" has a DOI that doesn't look right: ${doi}`,
        suggestedAction: 'Open the source meta.ttl and correct the bibo:doi value.',
      });
    }
  }
  return out;
}

/**
 * Sources missing the bibliographic minimum — no `dc:title` OR no `dc:creator`
 * (#119). Stubs are intentionally partial, so they're excluded.
 */
function missingMetadata(sources: SourceFacts[]): Inspection[] {
  const out: Inspection[] = [];
  for (const s of sources) {
    if (s.values.stub.length > 0) continue;
    const hasTitle = s.values.title.length > 0;
    const hasCreator = s.values.creator.length > 0;
    if (hasTitle && hasCreator) continue;
    const label = labelOf(s);
    const missing: string[] = [];
    if (!hasTitle) missing.push('title');
    if (!hasCreator) missing.push('authors');
    out.push({
      id: `source-missing-metadata-${out.length}`,
      type: 'source_missing_metadata',
      severity: 'info',
      nodeUri: s.iri,
      nodeLabel: label,
      message: `Source "${label}" is missing ${missing.join(' and ')}.`,
      suggestedAction: missing.includes('title')
        ? 'Open meta.ttl and set dc:title.'
        : 'Open meta.ttl and add dc:creator entries.',
    });
    if (out.length >= MISSING_METADATA_LIMIT) break;
  }
  return out;
}

/**
 * Reference stubs (#106) that have lingered unresolved for more than
 * `stubDays` days (#119). Oldest first, as the old `ORDER BY ?modified` said.
 */
function agedStubs(sources: SourceFacts[], stubDays: number): Inspection[] {
  const cutoff = new Date(Date.now() - stubDays * DAY_MS).toISOString();
  const aged = sources
    .filter((s) => s.values.stub.includes('unresolved'))
    // The oldest of a source's `dc:modified` values, matching the staleness
    // check's MIN (#2309): a source is as stale as the earliest edit recorded
    // for it, and taking one value per source stops a second `dc:modified`
    // listing the same stub twice.
    .flatMap((s) => {
      const oldest = s.values.modified[0];
      return oldest && oldest < cutoff ? [{ s, oldest }] : [];
    })
    .sort((a, b) => (a.oldest < b.oldest ? -1 : a.oldest > b.oldest ? 1 : idOf(a.s).localeCompare(idOf(b.s))))
    .slice(0, AGED_STUB_LIMIT);

  return aged.map(({ s, oldest }, i) => {
    const label = labelOf(s);
    return {
      id: `stub-aged-${i}`,
      type: 'stub_aged',
      severity: 'info' as const,
      nodeUri: s.iri,
      nodeLabel: label,
      message: `Stub "${label}" has been unresolved since ${oldest.split('T')[0]}.`,
      suggestedAction: 'Right-click the source and run "Resolve to full source", or hand-edit meta.ttl.',
      // Deterministic quick-fix (#1446): resolve the stub against CrossRef.
      fix: { kind: 'resolve-source-stub' as const, label: 'Resolve source', sourceId: idOf(s) },
    };
  });
}

/**
 * Sources cited by at least one note whose readStatus is unset or explicitly
 * "unread" (#119). Most-cited first, as the old `ORDER BY DESC(?cites)` said.
 */
function citedUnread(sources: SourceFacts[]): Inspection[] {
  const flagged = sources
    .filter((s) => s.cites > 0)
    .filter((s) => s.values.stub.length === 0)
    // `!BOUND(?status) || ?status = "unread"` — a source carrying both a
    // "read" and an "unread" assertion satisfied the old FILTER on the
    // "unread" binding, so it stays reported.
    .filter((s) => s.values.read.length === 0 || s.values.read.includes('unread'))
    .sort((a, b) => b.cites - a.cites || idOf(a).localeCompare(idOf(b)))
    .slice(0, CITED_UNREAD_LIMIT);

  return flagged.map((s, i) => {
    const label = labelOf(s);
    return {
      id: `source-cited-unread-${i}`,
      type: 'source_cited_unread',
      severity: 'info' as const,
      nodeUri: s.iri,
      nodeLabel: label,
      message: `"${label}" is cited ${s.cites === 1 ? 'once' : `${s.cites} times`} but you haven't marked it Reading or Read.`,
      suggestedAction: 'Open the source and set its reading status, or right-click → Mark reading.',
      // Deterministic quick-fix (#1446): mark the cited source read.
      fix: { kind: 'set-read-status' as const, label: 'Mark read', sourceId: idOf(s), status: 'read' as const },
    };
  });
}

/**
 * Sources sharing the same DOI or URL (#119). After the canonical-id rules
 * (#90) this shouldn't happen — but a hand-created source folder, or two
 * ingests that raced before the dedupe landed, still produce it.
 */
interface DuplicateGroup {
  /** The normalised value the members share — what the message names. */
  key: string;
  iri: string;
  ids: string[];
}

function duplicateGroups(sources: SourceFacts[], field: 'doi' | 'uri'): DuplicateGroup[] {
  const groups = new Map<string, SourceFacts[]>();
  for (const s of sources) {
    for (const raw of s.values[field]) {
      // `LCASE(?doi)` / `LCASE(REPLACE(STR(?uri), "/$", ""))`, as the old
      // queries' BIND clauses had it.
      const key = (field === 'uri' ? raw.replace(/\/$/, '') : raw).toLowerCase();
      const bucket = groups.get(key);
      if (bucket) { if (!bucket.includes(s)) bucket.push(s); } else groups.set(key, [s]);
    }
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, DUPLICATE_SOURCES_LIMIT)
    .map(([key, members]) => ({ key, iri: members[0]!.iri, ids: members.map(idOf).sort() }));
}

/**
 * The two duplicate inspections are built here rather than from one
 * parameterised helper so that `type: 'source_duplicate_doi'` and
 * `type: 'source_duplicate_uri'` appear as LITERALS in the engine source.
 * `tests/shared/inspections-catalog.test.ts` reads them out of it to prove no
 * catalog entry is a switch that controls nothing; a `type` arrived at through
 * a parameter is invisible to that, and the drift it exists to catch would be
 * back.
 */
function duplicateInspections(sources: SourceFacts[]): Inspection[] {
  const suggestedAction = 'Right-click one and choose "Merge into…" to consolidate.';
  const doi = duplicateGroups(sources, 'doi').map(({ key, iri, ids }, i) => ({
    id: `dup-doi-${i}`,
    type: 'source_duplicate_doi',
    severity: 'warning' as const,
    nodeUri: iri,
    nodeLabel: ids[0] ?? key,
    message: `Duplicate DOI ${key}: ${ids.length} sources (${ids.join(', ')}).`,
    suggestedAction,
    fix: { kind: 'merge-sources' as const, label: 'Merge…', sourceIds: ids },
  }));
  const uri = duplicateGroups(sources, 'uri').map(({ key, iri, ids }, i) => ({
    id: `dup-uri-${i}`,
    type: 'source_duplicate_uri',
    severity: 'warning' as const,
    nodeUri: iri,
    nodeLabel: ids[0] ?? key,
    message: `Duplicate URL ${key}: ${ids.length} sources (${ids.join(', ')}).`,
    suggestedAction,
    fix: { kind: 'merge-sources' as const, label: 'Merge…', sourceIds: ids },
  }));
  return [...doi, ...uri];
}

/**
 * Every enabled source inspection, from one scan (plus a citation count when
 * `citedUnread` is on). Returns `[]` without touching the graph when all five
 * are switched off — the skip, not a filter (#1792).
 */
export async function runSourceChecks(
  ctx: ProjectContext,
  plan: SourceCheckPlan,
): Promise<Inspection[]> {
  if (!anySourceCheckEnabled(plan)) return [];
  const sources = await loadSourceFacts(ctx, plan.citedUnread);

  const out: Inspection[] = [];
  if (plan.invalidDoi) out.push(...invalidDois(sources));
  if (plan.missingMetadata) out.push(...missingMetadata(sources));
  if (plan.agedStub) out.push(...agedStubs(sources, plan.stubDays));
  if (plan.citedUnread) out.push(...citedUnread(sources));
  if (plan.duplicates) out.push(...duplicateInspections(sources));
  return out;
}
