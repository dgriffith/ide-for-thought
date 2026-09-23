import { queryGraph, headingsFor } from './index';
import type { ProjectContext } from '../project-context-types';
import {
  healthStore,
  stateFor,
  getInspections,
  isRunning,
  type AutoState,
  type HealthCheckDeps,
} from './health-check-state';

// Per-project state lives next door (#2288) — see that module's header for
// why it is a separate concern, and why the split waited on `Inspection`
// moving to `shared/`. Re-exported because callers have always read the
// results from here.
export { getInspections, isRunning };
export type { HealthCheckDeps };
import { LINK_TYPES } from '../../shared/link-types';
import { DAY_MS } from '../../shared/time';
import { stripNoteExt, noteExtRank } from '../../shared/note-extensions';
import { noteTargetPathBeside } from '../../shared/wiki-link-resolver';
import { onGraphChanged } from './graph-events';
import { emitInspectionsChanged } from './inspection-events';
import { isA, labelOf, supportedBy, unsupported } from './argument-patterns';
import { runSourceChecks } from './source-checks';
import {
  catalogTypeFor,
  isInspectionEnabled,
  DEFAULT_INSPECTION_SETTINGS,
  type InspectionSettings,
  type Inspection,
  type InspectionSeverity,
} from '../../shared/inspections';

// The result type lives in `shared/inspections.ts` beside the catalog (#2288);
// this module owns how each check is COMPUTED, not what a finding looks like.
// Re-exported because callers have always imported it from here.
export type { Inspection, InspectionSeverity };

// ── Types ──────────────────────────────────────────────────────────────────


// ── Named Constants ────────────────────────────────────────────────────────
// (replacing magic numbers throughout the file for maintainability)

/** Stale note check: max results to report */
const STALE_NOTES_LIMIT = 20;

/** Broken links check: max links to scan before hitting soft cap */
const BROKEN_LINKS_QUERY_LIMIT = 1000;

/** Broken links check: soft cap on reported inspections (prevents panel drowning) */
const BROKEN_LINKS_REPORT_CAP = 50;

/** Periodic checks interval: 5 minutes */
const PERIODIC_CHECKS_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;



/** The SPARQL rows every check reads, cast to the string-record shape once
 *  instead of at each call site. `queryGraph` auto-injects the standard prefixes
 *  (`injectSparqlPrefixes`), so the checks' SELECT bodies omit the PREFIX
 *  boilerplate (#1602). */
function asRows(result: Awaited<ReturnType<typeof queryGraph>>): Record<string, string>[] {
  return result.results as Record<string, string>[];
}

// ── Run All Checks ─────────────────────────────────────────────────────────

/**
 * Run every ENABLED check. `settings` comes from the per-machine inspection
 * config (#1792); omitting it runs everything at the built-in thresholds, which
 * is what tests and any non-Electron caller want.
 *
 * A disabled check is skipped rather than filtered afterwards — the point of
 * switching one off is not to pay for it, and several of these are whole-graph
 * SPARQL queries.
 *
 * The two checks that emit more than one type (evidence gaps → missing_warrant
 * + missing_backing; duplicate sources → doi + uri) are gated on the type the
 * settings panel actually offers.
 */

export async function runAllChecks(
  ctx: ProjectContext,
  settings: InspectionSettings = DEFAULT_INSPECTION_SETTINGS,
  deps: HealthCheckDeps = {},
): Promise<Inspection[]> {
  const state = stateFor(ctx);
  if (state.running) return state.lastResults;
  state.running = true;

  const on = (type: string) => isInspectionEnabled(type, settings);
  const none = (): Promise<Inspection[]> => Promise.resolve([]);

  try {
    const results = await Promise.all([
      on('unsupported_claim') ? checkUnsupportedClaims(ctx) : none(),
      on('stale_note') ? checkStaleness(ctx, settings.staleDays) : none(),
      on('missing_warrant') || on('missing_backing') ? checkEvidenceGaps(ctx) : none(),
      on('contradiction') ? checkContradictions(ctx) : none(),
      // The five source checks share ONE scan of the source table rather than
      // opening `?source minerva:sourceId ?sourceId` six times over (#2208
      // C1b) — see `source-checks.ts`. They stay individually switchable; what
      // they no longer do is each pay for their own walk.
      runSourceChecks(ctx, {
        invalidDoi: on('invalid_doi'),
        missingMetadata: on('source_missing_metadata'),
        agedStub: on('stub_aged'),
        citedUnread: on('source_cited_unread'),
        duplicates: on('source_duplicate_doi'),
        stubDays: settings.stubDays,
      }),
      on('broken_note_link') || on('broken_anchor_link') || on('broken_cite_quote')
        ? checkBrokenLinks(ctx)
        : none(),
      // Enabled AND wired: without an injected scanner there is no filesystem
      // to look at, so the check has nothing to report (see HealthCheckDeps).
      on('unreferenced_image') && deps.findOrphanedAssets
        ? checkUnreferencedImages(ctx, deps.findOrphanedAssets)
        : none(),
    ]);
    // The multi-type checks above run as a unit, so drop the individual types
    // the user switched off.
    const flat = results.flat().filter((i) => isInspectionEnabled(catalogTypeFor(i.type), settings));
    state.lastResults = flat;
    // Tell anyone showing the results that they moved (#1795) — runs are no
    // longer only user-initiated, so the panel can't assume it caused them.
    //
    // Unless the project closed while this run was in flight. `state` is then
    // a detached object the store no longer holds (dispose removes it before
    // running its hook), so these results are unreachable and announcing them
    // would wake a panel for a thoughtbase that isn't open.
    if (healthStore.get(ctx) === state) emitInspectionsChanged(ctx.rootPath);
    return flat;
  } finally {
    state.running = false;
  }
}

// ── Individual Checks ──────────────────────────────────────────────────────

async function checkUnsupportedClaims(ctx: ProjectContext): Promise<Inspection[]> {
  const results = await queryGraph(ctx, `
    SELECT ?claim ?label ?notePath WHERE {
      ${isA('claim', 'Claim')}
      ${labelOf('claim', 'label')}
      OPTIONAL { ?claim minerva:relativePath ?notePath }
      ${unsupported('claim')}
    }
  `);

  return asRows(results).map((r, i) => ({
    id: `unsupported-${i}`,
    type: 'unsupported_claim',
    severity: 'warning' as const,
    nodeUri: r.claim!,
    nodeLabel: r.label!,
    message: `Claim "${r.label}" has no supporting evidence`,
    suggestedAction: 'Add grounds or evidence that supports this claim',
    ...(r.notePath ? { notePath: r.notePath } : {}),
  }));
}

/**
 * "Oldest N" without asking Comunica to sort the whole corpus (#2208).
 *
 * SPARQL evaluates ORDER BY before LIMIT, so `ORDER BY ?modified LIMIT n` sorts
 * EVERY matching row and then throws almost all of it away. In a mature
 * thoughtbase the staleness FILTER matches nearly every note, so "almost all of
 * it" is the corpus: measured 546ms at 1,000 stale notes, 1,064ms at 3,000.
 *
 * The obvious fix — drop ORDER BY and sort the rows in JS — does not work, and
 * it is worth writing down why so nobody re-tries it. Without a LIMIT the query
 * has to materialise every match: measured 605ms at 1,000, i.e. SLOWER than the
 * ORDER BY it replaces. The cost was never the sort; it is carrying four bound
 * variables per row through it. Dropping ORDER BY while keeping the LIMIT is
 * fast (63ms) but silently changes WHICH notes are reported from "the oldest n"
 * to "an arbitrary n", which is a behaviour change wearing a performance fix's
 * clothing.
 *
 * So: sort a two-variable projection, then fetch the details for the handful of
 * IRIs that survived. 129ms + 53ms against 527ms at 1,000 notes, with the
 * selection semantics unchanged. Two queries rather than one, which is the
 * right trade even against C1b's "fewer round-trips" — both are cheap, and
 * together they are a third of the single query they replace.
 *
 * ── The GROUP BY is the same cliff, one step along (#2208 C1b) ─────────────
 *
 * The version above shipped as `GROUP BY ?note (MIN(?modified)) ORDER BY
 * ?oldest LIMIT n`, and it left most of the cost in place. Measured at 3,000
 * notes where every note is stale — the "mature thoughtbase" case the header
 * describes, and the one the bench cannot reach, because
 * `health-checks.bench.ts` writes notes with no frontmatter `modified`, so
 * their `dc:modified` is the file's just-written mtime and NOTHING matches the
 * 30-day filter:
 *
 *   | phase-one shape                           | 3,000 notes |
 *   |-------------------------------------------|-------------|
 *   | `GROUP BY ?note (MIN(…)) ORDER BY LIMIT`  |   1,009ms   |
 *   | `GROUP BY ?note (MIN(…))`, no ORDER BY    |     887ms   |
 *   | raw `?note ?modified`, aggregate in JS    |      80ms   |
 *
 * So the ORDER BY was ~120ms of a ~1,000ms query: Comunica's grouping over
 * 3,000 distinct keys is what costs, and moving the sort out of SPARQL left it
 * untouched. (Grouping is not slow per se — the citation counts in
 * `source-checks.ts` group 3,000 rows into 40 keys in 25ms. It is the KEY
 * COUNT, not the row count.)
 *
 * Aggregating in JS is the conclusion of the header's own diagnosis rather
 * than a contradiction of it: "the cost is carrying four bound variables per
 * row" is right, and this projection carries two. 3,000 rows of `{note,
 * modified}` cost 80ms to materialise; the MIN-per-note, the sort and the
 * slice over them are microseconds. Selection semantics are unchanged, which
 * `staleness-selection.test.ts` — written for the previous fix and untouched
 * by this one — is what proves.
 */
async function oldestMatching(
  ctx: ProjectContext,
  opts: { subjectVar: string; where: string; limit: number },
): Promise<Array<{ iri: string; modified: string }>> {
  const { subjectVar: v, where, limit } = opts;
  const results = await queryGraph(ctx, `
    SELECT ?${v} ?modified WHERE {
      ${where}
    }
  `);

  // MIN per subject, not a row-wise DISTINCT: a note carries TWO `dc:modified`
  // values — the file's mtime and the frontmatter's — so keeping both would
  // make the limit count rows rather than notes, and "20 stale notes" could be
  // ten notes listed twice. MIN also picks the right date to sort and report
  // on: the older of the two is what makes a note stale.
  //
  // Compared as strings. Every `dc:modified` the indexer writes is a
  // `Z`-suffixed ISO-8601 instant, for which lexicographic and chronological
  // order agree; a hand-written frontmatter date carrying a numeric UTC offset
  // could in principle sort within a few hours of its true place. The
  // membership decision is unaffected — SPARQL's `FILTER` above still made it
  // by value — so the only reachable consequence is the order of two notes
  // stale by the same day, which is why this isn't worth a date parse per row.
  const oldest = new Map<string, string>();
  for (const r of asRows(results)) {
    const iri = r[v];
    const modified = r.modified;
    if (!iri || !modified) continue;
    const seen = oldest.get(iri);
    if (seen === undefined || modified < seen) oldest.set(iri, modified);
  }

  return [...oldest.entries()]
    // Ties broken by IRI so the panel's order is stable between runs rather
    // than however the engine happened to emit them.
    .sort(([aIri, a], [bIri, b]) => (a < b ? -1 : a > b ? 1 : aIri.localeCompare(bIri)))
    .slice(0, limit)
    .map(([iri, modified]) => ({ iri, modified }));
}

/** `VALUES ?v { <a> <b> }`, or null when there is nothing to look up. */
function valuesClause(subjectVar: string, iris: string[]): string | null {
  if (iris.length === 0) return null;
  return `VALUES ?${subjectVar} { ${iris.map((u) => `<${u}>`).join(' ')} }`;
}

async function checkStaleness(ctx: ProjectContext, thresholdDays: number): Promise<Inspection[]> {
  const cutoff = new Date(Date.now() - thresholdDays * DAY_MS).toISOString();

  const oldest = await oldestMatching(ctx, {
    subjectVar: 'note',
    where: `
      ?note a minerva:Note .
      ?note dc:modified ?modified .
      FILTER(?modified < "${cutoff}"^^<http://www.w3.org/2001/XMLSchema#dateTime>)`,
    limit: STALE_NOTES_LIMIT,
  });
  const values = valuesClause('note', oldest.map((o) => o.iri));
  if (!values) return [];

  // Details for the handful that survived. `?modified` is deliberately NOT
  // re-read here — phase one already chose which of the note's two dates
  // matters, and re-joining it would bring the duplication straight back.
  const results = await queryGraph(ctx, `
    SELECT DISTINCT ?note ?path ?title WHERE {
      ${values}
      ?note minerva:relativePath ?path .
      ?note dc:title ?title .
    }
  `);
  const detail = new Map(asRows(results).map((r) => [r.note!, r]));

  // Ordered by the phase-one result, so the panel still lists oldest first.
  return oldest.flatMap(({ iri, modified }, i) => {
    const r = detail.get(iri);
    if (!r?.title) return [];
    return [{
      id: `stale-${i}`,
      type: 'stale_note',
      severity: 'info' as const,
      nodeUri: iri,
      nodeLabel: r.title,
      message: `"${r.title}" hasn't been modified since ${modified.split('T')[0]}`,
      suggestedAction: 'Review whether this note is still current',
      ...(r.path ? { notePath: r.path } : {}),
    }];
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * `.minerva/assets/inline/` files nothing currently references (#1799) — see
 * `notebase/asset-references.ts` for how "unreferenced" is decided. Info
 * severity: an orphaned image is disk hygiene, not a correctness problem.
 */
async function checkUnreferencedImages(
  ctx: ProjectContext,
  findOrphanedAssets: NonNullable<HealthCheckDeps['findOrphanedAssets']>,
): Promise<Inspection[]> {
  const orphans = await findOrphanedAssets(ctx.rootPath);
  return orphans.map((o, i) => {
    const name = o.relativePath.split('/').pop()!;
    return {
      id: `unreferenced-image-${i}`,
      type: 'unreferenced_image',
      severity: 'info' as const,
      // No graph node exists for a raw asset file — synthesize a stable id.
      nodeUri: `urn:minerva:asset:${o.relativePath}`,
      nodeLabel: name,
      message: `"${name}" (${formatSize(o.sizeBytes)}) isn't referenced by any note, stylesheet, or retained history.`,
      suggestedAction: 'Delete it if you don\'t need it — nothing currently links to it.',
      fix: { kind: 'delete-asset', label: 'Delete image', assetPath: o.relativePath },
    };
  });
}

async function checkEvidenceGaps(ctx: ProjectContext): Promise<Inspection[]> {
  const inspections: Inspection[] = [];

  // Claims with grounds but no warrant
  const noWarrant = await queryGraph(ctx, `
    SELECT ?claim ?label ?notePath WHERE {
      ${isA('claim', 'Claim')}
      ${labelOf('claim', 'label')}
      ${supportedBy('grounds', 'claim')}
      ${isA('grounds', 'Grounds')}
      OPTIONAL { ?claim minerva:relativePath ?notePath }
      ${unsupported('claim', 'Warrant')}
    }
  `);

  for (const [i, r] of asRows(noWarrant).entries()) {
    inspections.push({
      id: `no-warrant-${i}`,
      type: 'missing_warrant',
      severity: 'warning',
      nodeUri: r.claim!,
      nodeLabel: r.label!,
      message: `Claim "${r.label}" has grounds but no warrant connecting them`,
      suggestedAction: 'Add a warrant explaining why the grounds support this claim',
      ...(r.notePath ? { notePath: r.notePath } : {}),
    });
  }

  // Warrants with no backing
  const noBacking = await queryGraph(ctx, `
    SELECT ?warrant ?label ?notePath WHERE {
      ${isA('warrant', 'Warrant')}
      ${labelOf('warrant', 'label')}
      OPTIONAL { ?warrant minerva:relativePath ?notePath }
      ${unsupported('warrant', 'Backing')}
    }
  `);

  for (const [i, r] of asRows(noBacking).entries()) {
    inspections.push({
      id: `no-backing-${i}`,
      type: 'missing_backing',
      severity: 'info',
      nodeUri: r.warrant!,
      nodeLabel: r.label!,
      message: `Warrant "${r.label}" has no backing — why should we accept this reasoning principle?`,
      suggestedAction: 'Add backing that supports this warrant',
      ...(r.notePath ? { notePath: r.notePath } : {}),
    });
  }

  return inspections;
}

async function checkContradictions(ctx: ProjectContext): Promise<Inspection[]> {
  const results = await queryGraph(ctx, `
    SELECT ?a ?aLabel ?b ?bLabel ?notePath WHERE {
      ?a thought:contradicts ?b .
      ?a thought:hasStatus thought:established .
      ?b thought:hasStatus thought:established .
      ${labelOf('a')}
      ${labelOf('b')}
      OPTIONAL { ?a minerva:relativePath ?notePath }
    }
  `);

  return asRows(results).map((r, i) => ({
    id: `contradiction-${i}`,
    type: 'contradiction',
    severity: 'concern' as const,
    nodeUri: r.a!,
    nodeLabel: r.aLabel!,
    message: `Established claim "${r.aLabel}" contradicts established claim "${r.bLabel}"`,
    suggestedAction: 'Review both claims — at least one needs to be revised or its status changed',
    ...(r.notePath ? { notePath: r.notePath } : {}),
  }));
}

/**
 * Walk every typed wiki-link triple in the graph and flag the ones
 * whose target doesn't exist (#140). Three kinds of breakage:
 *
 *   - **broken_note_link** — `[[missing-note]]` or any typed link to
 *     a note relativePath that isn't in the project.
 *   - **broken_anchor_link** — `[[note#heading]]` where the note
 *     exists but no heading slugifies to the fragment. (Block-id
 *     anchors `#^id` are intentionally skipped — they don't live in
 *     the graph; checking them would need a full body re-scan.)
 *   - **broken_cite_quote** — `[[cite::id]]` / `[[quote::id]]` where
 *     no source / excerpt exists with that id.
 *
 * Severity is `warning`: broken links are often intentional WIP
 * stubs, not data-corruption. The inspection reports; the user
 * fixes (no auto-fix per scope note).
 */
async function checkBrokenLinks(ctx: ProjectContext): Promise<Inspection[]> {
  // Build the IN-list of link predicates from the typed-link
  // registry so adding a new link type elsewhere automatically
  // extends the check.
  const predicateIris = LINK_TYPES.map((lt) => {
    const ns = lt.predicateNamespace === 'thought'
      ? 'https://minerva.dev/ontology/thought#'
      : 'https://minerva.dev/ontology#';
    return `<${ns}${lt.predicate}>`;
  });
  const valuesClause = predicateIris.join(' ');

  // Pre-fetch the valid-target sets so per-row lookups are O(1).
  const [notesRes, sourcesRes, excerptsRes] = await Promise.all([
    queryGraph(ctx, `
      SELECT ?path WHERE { ?n minerva:relativePath ?path . ?n a minerva:Note }
    `),
    queryGraph(ctx, `
      SELECT ?id WHERE { ?s minerva:sourceId ?id }
    `),
    queryGraph(ctx, `
      SELECT ?id WHERE { ?e minerva:excerptId ?id }
    `),
  ]);
  // Note validity is keyed by STEM, not full path (#1446): a link `[[budget]]`
  // resolves to `budget.csv`/`.ttl`/`.py`, not just `budget.md`. Map stem →
  // real relativePath, keeping the highest-precedence extension (`.md` first)
  // when several notes share a stem — mirrors the wiki-link resolver.
  const validNoteStems = new Map<string, string>();
  for (const r of notesRes.results as { path: string }[]) {
    const stem = stripNoteExt(r.path);
    const existing = validNoteStems.get(stem);
    if (existing === undefined || noteExtRank(r.path) < noteExtRank(existing)) {
      validNoteStems.set(stem, r.path);
    }
  }
  const validSources = new Set((sourcesRes.results as { id: string }[]).map((r) => r.id));
  const validExcerpts = new Set((excerptsRes.results as { id: string }[]).map((r) => r.id));

  // Walk every link triple — across every typed-link predicate.
  const linksRes = await queryGraph(ctx, `
    SELECT ?source ?sourcePath ?predicate ?target WHERE {
      ?source minerva:relativePath ?sourcePath .
      ?source ?predicate ?target .
      VALUES ?predicate { ${valuesClause} }
    }
    LIMIT ${BROKEN_LINKS_QUERY_LIMIT}
  `);

  const inspections: Inspection[] = [];
  let counter = 0;
  for (const row of linksRes.results as { source: string; sourcePath: string; predicate: string; target: string }[]) {
    const classified = classifyTarget(row.target);
    if (!classified) continue;
    const ins = inspectionForBrokenLink(ctx, row, classified, validNoteStems, validSources, validExcerpts, counter);
    if (ins) {
      inspections.push(ins);
      counter++;
    }
    if (inspections.length >= BROKEN_LINKS_REPORT_CAP) break;
  }
  return inspections;
}

/** A wiki-link target IRI parsed into kind + base + optional fragment. */
interface ClassifiedTarget {
  kind: 'note' | 'source' | 'excerpt' | null;
  /** The identifier portion — for notes, the extension-less STEM (so it matches
   *  a note of any extension, #1446); sourceId / excerptId for the others.
   *  URL-decoded. */
  id: string;
  /** Fragment after `#`, decoded; null when none. */
  anchor: string | null;
}

function classifyTarget(iri: string): ClassifiedTarget | null {
  // Strip the fragment first so we can match against the base form.
  const hashIdx = iri.lastIndexOf('#');
  const base = hashIdx >= 0 ? iri.slice(0, hashIdx) : iri;
  const anchor = hashIdx >= 0 ? decode(iri.slice(hashIdx + 1)) : null;

  // Match the segment after the last `note/` / `source/` / `excerpt/`.
  const noteIdx = base.lastIndexOf('/note/');
  if (noteIdx >= 0) {
    const id = decodeSegmented(base.slice(noteIdx + '/note/'.length));
    // Note URIs strip `.md`/`.ttl` but keep `.csv`/`.py` (uri-helpers noteUri),
    // so normalise to a bare stem and match a note of ANY extension (#1446).
    return { kind: 'note', id: stripNoteExt(id), anchor };
  }
  const sourceIdx = base.lastIndexOf('/source/');
  if (sourceIdx >= 0) {
    return { kind: 'source', id: decode(base.slice(sourceIdx + '/source/'.length)), anchor };
  }
  const excerptIdx = base.lastIndexOf('/excerpt/');
  if (excerptIdx >= 0) {
    return { kind: 'excerpt', id: decode(base.slice(excerptIdx + '/excerpt/'.length)), anchor };
  }
  return null; // external URI or unknown shape — not our concern.
}

function decode(s: string): string {
  try { return decodeURIComponent(s); }
  catch { return s; }
}

/** Decode a `note/` path that's been segment-encoded so slashes survive. */
function decodeSegmented(s: string): string {
  return s.split('/').map(decode).join('/');
}


function inspectionForBrokenLink(
  ctx: ProjectContext,
  row: { source: string; sourcePath: string; predicate: string; target: string },
  classified: ClassifiedTarget,
  validNoteStems: Map<string, string>,
  validSources: Set<string>,
  validExcerpts: Set<string>,
  index: number,
): Inspection | null {
  if (classified.kind === 'source') {
    if (validSources.has(classified.id)) return null;
    return {
      id: `broken-cite-${index}`,
      type: 'broken_cite_quote',
      severity: 'warning',
      nodeUri: row.source,
      nodeLabel: row.sourcePath,
      notePath: row.sourcePath,
      message: `Note "${row.sourcePath}" cites an unknown source: ${classified.id}`,
      suggestedAction: 'Ingest the source via Ingest Identifier… or fix the `[[cite::id]]` target.',
    };
  }
  if (classified.kind === 'excerpt') {
    if (validExcerpts.has(classified.id)) return null;
    return {
      id: `broken-quote-${index}`,
      type: 'broken_cite_quote',
      severity: 'warning',
      nodeUri: row.source,
      nodeLabel: row.sourcePath,
      notePath: row.sourcePath,
      message: `Note "${row.sourcePath}" quotes an unknown excerpt: ${classified.id}`,
      suggestedAction: 'Create the excerpt from the source viewer, or fix the `[[quote::id]]` target.',
    };
  }
  if (classified.kind === 'note') {
    // `classified.id` is an extension-less stem; look it up against the
    // stem→realPath map so a link to a `.csv`/`.ttl`/`.py` note counts as
    // resolved, not broken (#1446).
    const realPath = validNoteStems.get(classified.id);
    if (realPath === undefined) {
      const stem = classified.id;
      const linkText = classified.anchor ? `${stem}#${classified.anchor}` : stem;
      return {
        id: `broken-note-${index}`,
        type: 'broken_note_link',
        severity: 'warning',
        nodeUri: row.source,
        nodeLabel: row.sourcePath,
        notePath: row.sourcePath,
        message: `Note "${row.sourcePath}" links to a missing note: [[${linkText}]]`,
        suggestedAction: 'Create the target note, fix the spelling, or remove the link.',
        // Deterministic quick-fix (#1446): create the missing note beside the
        // note that references it. The basename comes from the link target;
        // the directory from the referencing note's path (an anchor, if any,
        // is dropped — we create the note, not the heading).
        fix: {
          kind: 'create-note',
          label: 'Create Note',
          targetPath: noteTargetPathBeside(row.sourcePath, stem),
        },
      };
    }
    // Note exists. Check anchor when one was specified — but only for markdown
    // targets: `headingsFor` is populated only for `.md` notes, so a non-md
    // target has no headings to check against and an anchor would always
    // false-flag. Block-id anchors (`#^id`) are also skipped — they're
    // scattered through the note body, not stored as triples.
    if (classified.anchor && !classified.anchor.startsWith('^') && realPath.endsWith('.md')) {
      const headings = headingsFor(ctx, realPath);
      const found = headings.some((h) => h.slug === classified.anchor);
      if (!found) {
        const stem = classified.id;
        return {
          id: `broken-anchor-${index}`,
          type: 'broken_anchor_link',
          severity: 'warning',
          nodeUri: row.source,
          nodeLabel: row.sourcePath,
          notePath: row.sourcePath,
          message: `Note "${row.sourcePath}" links to a missing heading: [[${stem}#${classified.anchor}]]`,
          suggestedAction: 'Add the heading to the target note, fix the anchor slug, or remove the `#…` part.',
          // Deterministic quick-fix (#1446): drop the broken `#heading` so the
          // link points at the note itself. targetPath is the resolved note;
          // classified.anchor is the (slugified) missing heading.
          fix: {
            kind: 'remove-anchor',
            label: 'Remove anchor',
            notePath: row.sourcePath,
            targetPath: realPath,
            anchor: classified.anchor,
          },
        };
      }
    }
  }
  return null;
}

// ── Automatic runs ─────────────────────────────────────────────────────────

/**
 * Re-run the checks shortly after the graph changes (#1795).
 *
 * Saving a note is when you most want to know you've just broken a link, and
 * waiting up to five minutes for the next timer tick made the panel feel
 * broken. Every graph write emits `graphChanged`; this debounces the burst
 * (a bulk index at project open emits once per note) and runs once things
 * settle.
 *
 * The debounce is a floor, not a promise: a run already in flight is left to
 * finish and the next change schedules another.
 */

export const DEFAULT_CHECK_DEBOUNCE_MS = 2000;

export function armAutoChecks(
  ctx: ProjectContext,
  opts: {
    loadSettings: () => Promise<InspectionSettings>;
    debounceMs?: number;
  } & HealthCheckDeps,
): void {
  disarmAutoChecks(ctx);
  const state: AutoState = {
    timer: null,
    loadSettings: opts.loadSettings,
    // `opts` already widens to HealthCheckDeps; rebuilding the object would
    // trip `exactOptionalPropertyTypes` on an absent scanner.
    deps: opts,
    debounceMs: opts.debounceMs ?? DEFAULT_CHECK_DEBOUNCE_MS,
    unsubscribe: () => {},
  };
  state.unsubscribe = onGraphChanged((rootPath) => {
    // One armed project per root; ignore writes to other open thoughtbases.
    if (rootPath !== ctx.rootPath) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      void (async () => {
        await runAllChecks(ctx, await state.loadSettings(), state.deps);
      })();
    }, state.debounceMs);
  });
  stateFor(ctx).auto = state;
}

export function disarmAutoChecks(ctx: ProjectContext): void {
  const auto = healthStore.get(ctx)?.auto;
  if (!auto) return;
  if (auto.timer) clearTimeout(auto.timer);
  auto.unsubscribe();
  healthStore.get(ctx)!.auto = null;
}

// ── Timer ──────────────────────────────────────────────────────────────────

/**
 * Re-run the checks every `intervalMs`.
 *
 * `loadSettings` is injected rather than imported because the settings loader
 * reaches `electron`, and this module is imported all over the test suite —
 * see the module header of `shared/inspections.ts`. Omitting it runs at the
 * built-in defaults, which is only right for a caller that has no user
 * settings to honour.
 */
export function startPeriodicChecks(
  ctx: ProjectContext,
  opts: {
    loadSettings?: () => Promise<InspectionSettings>;
    intervalMs?: number;
  } & HealthCheckDeps = {},
): void {
  stopPeriodicChecks(ctx);
  const intervalMs = opts.intervalMs ?? PERIODIC_CHECKS_DEFAULT_INTERVAL_MS;
  const timer = setInterval(() => {
    void (async () => {
      const settings = opts.loadSettings ? await opts.loadSettings() : DEFAULT_INSPECTION_SETTINGS;
      await runAllChecks(ctx, settings, opts);
    })();
  }, intervalMs);
  stateFor(ctx).periodicTimer = timer;
}

export function stopPeriodicChecks(ctx: ProjectContext): void {
  const state = healthStore.get(ctx);
  if (!state?.periodicTimer) return;
  clearInterval(state.periodicTimer);
  state.periodicTimer = null;
}
