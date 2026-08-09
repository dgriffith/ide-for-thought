import { queryGraph, headingsFor } from './index';
import type { ProjectContext } from '../project-context-types';
import { LINK_TYPES } from '../../shared/link-types';
import { DAY_MS } from './queries';
import type { InspectionFix } from '../../shared/types';
import { stripNoteExt, noteExtRank } from '../../shared/note-extensions';
import { noteTargetPathBeside } from '../../shared/wiki-link-resolver';
import {
  catalogTypeFor,
  isInspectionEnabled,
  DEFAULT_INSPECTION_SETTINGS,
  type InspectionSettings,
} from '../../shared/inspections';

// ── Types ──────────────────────────────────────────────────────────────────

export type InspectionSeverity = 'info' | 'warning' | 'concern';

export interface Inspection {
  id: string;
  type: string;
  severity: InspectionSeverity;
  nodeUri: string;
  nodeLabel: string;
  message: string;
  suggestedAction?: string;
  /** Optional deterministic quick-fix the panel can apply directly instead of
   *  opening a conversation (#1446). Absent when the only remedy is prose. */
  fix?: InspectionFix;
  /** The note this inspection is anchored to, as a project-relative path, when
   *  it belongs to one — the referencing note for a broken link, the stale note
   *  itself, a claim's own note. Lets the right-sidebar panel scope to the
   *  active note (#1446). Absent for source-scoped inspections (dupes, metadata)
   *  and standalone claim components, which aren't "on" a note. */
  notePath?: string;
}

const lastResultsByProject = new Map<string, Inspection[]>();
let running = false;

export function getInspections(ctx: ProjectContext): Inspection[] {
  return lastResultsByProject.get(ctx.rootPath) ?? [];
}

export function isRunning(): boolean {
  return running;
}

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
): Promise<Inspection[]> {
  if (running) return lastResultsByProject.get(ctx.rootPath) ?? [];
  running = true;

  const on = (type: string) => isInspectionEnabled(type, settings);
  const none = (): Promise<Inspection[]> => Promise.resolve([]);

  try {
    const results = await Promise.all([
      on('unsupported_claim') ? checkUnsupportedClaims(ctx) : none(),
      on('stale_note') ? checkStaleness(ctx, settings.staleDays) : none(),
      on('missing_warrant') || on('missing_backing') ? checkEvidenceGaps(ctx) : none(),
      on('contradiction') ? checkContradictions(ctx) : none(),
      on('invalid_doi') ? checkInvalidDois(ctx) : none(),
      on('source_missing_metadata') ? checkSourcesMissingMetadata(ctx) : none(),
      on('stub_aged') ? checkLongUnresolvedStubs(ctx, settings.stubDays) : none(),
      on('source_cited_unread') ? checkCitedUnreadSources(ctx) : none(),
      on('source_duplicate_doi') ? checkDuplicateSources(ctx) : none(),
      on('broken_note_link') || on('broken_anchor_link') || on('broken_cite_quote')
        ? checkBrokenLinks(ctx)
        : none(),
    ]);
    // The multi-type checks above run as a unit, so drop the individual types
    // the user switched off.
    const flat = results.flat().filter((i) => isInspectionEnabled(catalogTypeFor(i.type), settings));
    lastResultsByProject.set(ctx.rootPath, flat);
    return flat;
  } finally {
    running = false;
  }
}

// ── Individual Checks ──────────────────────────────────────────────────────

async function checkUnsupportedClaims(ctx: ProjectContext): Promise<Inspection[]> {
  const results = await queryGraph(ctx, `
    SELECT ?claim ?label ?notePath WHERE {
      ?claim a thought:Claim .
      ?claim thought:label ?label .
      OPTIONAL { ?claim minerva:relativePath ?notePath }
      FILTER NOT EXISTS { ?other thought:supports ?claim }
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

async function checkStaleness(ctx: ProjectContext, thresholdDays: number): Promise<Inspection[]> {
  const cutoff = new Date(Date.now() - thresholdDays * DAY_MS).toISOString();

  const results = await queryGraph(ctx, `
    SELECT ?note ?path ?title ?modified WHERE {
      ?note a minerva:Note .
      ?note minerva:relativePath ?path .
      ?note dc:title ?title .
      ?note dc:modified ?modified .
      FILTER(?modified < "${cutoff}"^^<http://www.w3.org/2001/XMLSchema#dateTime>)
    }
    ORDER BY ?modified
    LIMIT 20
  `);

  return asRows(results).map((r, i) => ({
    id: `stale-${i}`,
    type: 'stale_note',
    severity: 'info' as const,
    nodeUri: r.note!,
    nodeLabel: r.title!,
    message: `"${r.title}" hasn't been modified since ${r.modified!.split('T')[0]}`,
    suggestedAction: 'Review whether this note is still current',
    ...(r.path ? { notePath: r.path } : {}),
  }));
}

async function checkEvidenceGaps(ctx: ProjectContext): Promise<Inspection[]> {
  const inspections: Inspection[] = [];

  // Claims with grounds but no warrant
  const noWarrant = await queryGraph(ctx, `
    SELECT ?claim ?label ?notePath WHERE {
      ?claim a thought:Claim .
      ?claim thought:label ?label .
      ?grounds thought:supports ?claim .
      ?grounds a thought:Grounds .
      OPTIONAL { ?claim minerva:relativePath ?notePath }
      FILTER NOT EXISTS {
        ?warrant thought:supports ?claim .
        ?warrant a thought:Warrant .
      }
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
      ?warrant a thought:Warrant .
      ?warrant thought:label ?label .
      OPTIONAL { ?warrant minerva:relativePath ?notePath }
      FILTER NOT EXISTS {
        ?backing thought:supports ?warrant .
        ?backing a thought:Backing .
      }
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

/**
 * Sources carrying a `bibo:doi` literal that doesn't match the
 * Crossref DOI shape (#473). Shape-only check — we don't hit
 * doi.org. Surfacing it through the inspections panel keeps the
 * warning soft and non-blocking, per the issue's "no popup" note.
 */
const VALID_DOI_RE = /^10\.\d{4,9}\/[-._;/:a-zA-Z0-9()]+$/;

async function checkInvalidDois(ctx: ProjectContext): Promise<Inspection[]> {
  const results = await queryGraph(ctx, `
    SELECT ?source ?sourceId ?title ?doi WHERE {
      ?source minerva:sourceId ?sourceId .
      ?source bibo:doi ?doi .
      OPTIONAL { ?source dc:title ?title }
    }
  `);

  return asRows(results).flatMap((r, i) => {
    if (!r.doi || VALID_DOI_RE.test(r.doi)) return [];
    const label = r.title || r.sourceId!;
    return [{
      id: `invalid-doi-${i}`,
      type: 'invalid_doi',
      severity: 'warning' as const,
      nodeUri: r.source!,
      nodeLabel: label,
      message: `Source "${label}" has a DOI that doesn't look right: ${r.doi}`,
      suggestedAction: 'Open the source meta.ttl and correct the bibo:doi value.',
    }];
  });
}

async function checkContradictions(ctx: ProjectContext): Promise<Inspection[]> {
  const results = await queryGraph(ctx, `
    SELECT ?a ?aLabel ?b ?bLabel ?notePath WHERE {
      ?a thought:contradicts ?b .
      ?a thought:hasStatus thought:established .
      ?b thought:hasStatus thought:established .
      ?a thought:label ?aLabel .
      ?b thought:label ?bLabel .
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
 * Sources missing the bibliographic minimum — no dc:title OR no
 * dc:creator (#119). Stubs are intentionally partial; filter them
 * out so the inspections panel surfaces only sources that should
 * have been populated but weren't.
 */
async function checkSourcesMissingMetadata(ctx: ProjectContext): Promise<Inspection[]> {
  const results = await queryGraph(ctx, `
    SELECT ?source ?sourceId ?title (GROUP_CONCAT(?creator; SEPARATOR=", ") AS ?creators) WHERE {
      ?source minerva:sourceId ?sourceId .
      OPTIONAL { ?source dc:title ?title }
      OPTIONAL { ?source dc:creator ?creator }
      FILTER NOT EXISTS { ?source thought:stubStatus ?_stub }
      FILTER(!BOUND(?title) || !BOUND(?creator))
    }
    GROUP BY ?source ?sourceId ?title
    LIMIT 50
  `);

  return asRows(results).map((r, i) => {
    const label = r.title || r.sourceId!;
    const missing: string[] = [];
    if (!r.title) missing.push('title');
    if (!r.creators) missing.push('authors');
    return {
      id: `source-missing-metadata-${i}`,
      type: 'source_missing_metadata',
      severity: 'info' as const,
      nodeUri: r.source!,
      nodeLabel: label,
      message: `Source "${label}" is missing ${missing.join(' and ')}.`,
      suggestedAction: missing.includes('title')
        ? 'Open meta.ttl and set dc:title.'
        : 'Open meta.ttl and add dc:creator entries.',
    };
  });
}

/**
 * Reference stubs (#106) that have lingered unresolved for more
 * than `thresholdDays` days (#119). Soft prompt to run Resolve
 * (#107) or hand-fix the stub.
 */
async function checkLongUnresolvedStubs(ctx: ProjectContext, thresholdDays: number): Promise<Inspection[]> {
  const cutoff = new Date(Date.now() - thresholdDays * DAY_MS).toISOString();
  const results = await queryGraph(ctx, `
    SELECT ?source ?sourceId ?title ?modified WHERE {
      ?source minerva:sourceId ?sourceId .
      ?source thought:stubStatus "unresolved" .
      ?source dc:modified ?modified .
      OPTIONAL { ?source dc:title ?title }
      FILTER(?modified < "${cutoff}"^^<http://www.w3.org/2001/XMLSchema#dateTime>)
    }
    ORDER BY ?modified
    LIMIT 50
  `);

  return asRows(results).map((r, i) => {
    const label = r.title || r.sourceId!;
    return {
      id: `stub-aged-${i}`,
      type: 'stub_aged',
      severity: 'info' as const,
      nodeUri: r.source!,
      nodeLabel: label,
      message: `Stub "${label}" has been unresolved since ${r.modified!.split('T')[0]}.`,
      suggestedAction: 'Right-click the source and run "Resolve to full source", or hand-edit meta.ttl.',
      // Deterministic quick-fix (#1446): resolve the stub against CrossRef.
      fix: { kind: 'resolve-source-stub', label: 'Resolve source', sourceId: r.sourceId! },
    };
  });
}

/**
 * Sources cited by at least one note whose readStatus is unset or
 * explicitly "unread" (#119). Soft nudge — "you cited this; have
 * you read it?"
 */
async function checkCitedUnreadSources(ctx: ProjectContext): Promise<Inspection[]> {
  const results = await queryGraph(ctx, `
    SELECT ?source ?sourceId ?title (COUNT(DISTINCT ?note) AS ?cites) WHERE {
      ?source minerva:sourceId ?sourceId .
      ?note thought:cites ?source .
      OPTIONAL { ?source dc:title ?title }
      OPTIONAL { ?source minerva:readStatus ?status }
      FILTER(!BOUND(?status) || ?status = "unread")
      FILTER NOT EXISTS { ?source thought:stubStatus ?_stub }
    }
    GROUP BY ?source ?sourceId ?title
    ORDER BY DESC(?cites)
    LIMIT 25
  `);

  return asRows(results).map((r, i) => {
    const label = r.title || r.sourceId!;
    const count = Number(r.cites ?? 0) || 0;
    return {
      id: `source-cited-unread-${i}`,
      type: 'source_cited_unread',
      severity: 'info' as const,
      nodeUri: r.source!,
      nodeLabel: label,
      message: `"${label}" is cited ${count === 1 ? 'once' : `${count} times`} but you haven't marked it Reading or Read.`,
      suggestedAction: 'Open the source and set its reading status, or right-click → Mark reading.',
      // Deterministic quick-fix (#1446): mark the cited source read.
      fix: { kind: 'set-read-status', label: 'Mark read', sourceId: r.sourceId!, status: 'read' },
    };
  });
}

/**
 * Sources sharing the same DOI or URL (#119). After the canonical-id
 * rules (#90) this shouldn't happen — but if a user hand-creates a
 * source folder, or two ingests raced before the dedupe landed,
 * the safety net flags the duplicates so they can be merged via
 * #90 part 2.
 */
async function checkDuplicateSources(ctx: ProjectContext): Promise<Inspection[]> {
  const inspections: Inspection[] = [];

  // Duplicate DOIs (lowercased).
  const dupDois = await queryGraph(ctx, `
    SELECT ?keyDoi (GROUP_CONCAT(DISTINCT ?source; SEPARATOR=" || ") AS ?sources)
           (GROUP_CONCAT(DISTINCT ?sourceId; SEPARATOR=" || ") AS ?ids) WHERE {
      ?source minerva:sourceId ?sourceId .
      ?source bibo:doi ?doi .
      BIND(LCASE(?doi) AS ?keyDoi)
    }
    GROUP BY ?keyDoi
    HAVING (COUNT(DISTINCT ?source) > 1)
    LIMIT 25
  `);
  for (const [i, r] of asRows(dupDois).entries()) {
    const ids = (r.ids ?? '').split(' || ').filter(Boolean);
    const firstSource = (r.sources ?? '').split(' || ')[0] ?? '';
    inspections.push({
      id: `dup-doi-${i}`,
      type: 'source_duplicate_doi',
      severity: 'warning',
      nodeUri: firstSource,
      nodeLabel: ids[0] ?? r.keyDoi!,
      message: `Duplicate DOI ${r.keyDoi}: ${ids.length} sources (${ids.join(', ')}).`,
      suggestedAction: 'Right-click one and choose "Merge into…" to consolidate.',
      // Quick-fix (#1446): pick which duplicate to keep, merge the rest into it.
      fix: { kind: 'merge-sources', label: 'Merge…', sourceIds: ids },
    });
  }

  // Duplicate URIs (lowercased, trailing slash normalised).
  const dupUris = await queryGraph(ctx, `
    SELECT ?keyUri (GROUP_CONCAT(DISTINCT ?source; SEPARATOR=" || ") AS ?sources)
           (GROUP_CONCAT(DISTINCT ?sourceId; SEPARATOR=" || ") AS ?ids) WHERE {
      ?source minerva:sourceId ?sourceId .
      ?source bibo:uri ?uri .
      BIND(LCASE(REPLACE(STR(?uri), "/$", "")) AS ?keyUri)
    }
    GROUP BY ?keyUri
    HAVING (COUNT(DISTINCT ?source) > 1)
    LIMIT 25
  `);
  for (const [i, r] of asRows(dupUris).entries()) {
    const ids = (r.ids ?? '').split(' || ').filter(Boolean);
    const firstSource = (r.sources ?? '').split(' || ')[0] ?? '';
    inspections.push({
      id: `dup-uri-${i}`,
      type: 'source_duplicate_uri',
      severity: 'warning',
      nodeUri: firstSource,
      nodeLabel: ids[0] ?? r.keyUri!,
      message: `Duplicate URL ${r.keyUri}: ${ids.length} sources (${ids.join(', ')}).`,
      suggestedAction: 'Right-click one and choose "Merge into…" to consolidate.',
      // Quick-fix (#1446): pick which duplicate to keep, merge the rest into it.
      fix: { kind: 'merge-sources', label: 'Merge…', sourceIds: ids },
    });
  }

  return inspections;
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
    LIMIT 1000
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
    if (inspections.length >= 50) break; // soft cap so we don't drown the panel
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

// ── Timer ──────────────────────────────────────────────────────────────────

const timersByProject = new Map<string, ReturnType<typeof setInterval>>();

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
  opts: { loadSettings?: () => Promise<InspectionSettings>; intervalMs?: number } = {},
): void {
  stopPeriodicChecks(ctx);
  const intervalMs = opts.intervalMs ?? 5 * 60 * 1000;
  const timer = setInterval(() => {
    void (async () => {
      const settings = opts.loadSettings ? await opts.loadSettings() : DEFAULT_INSPECTION_SETTINGS;
      await runAllChecks(ctx, settings);
    })();
  }, intervalMs);
  timersByProject.set(ctx.rootPath, timer);
}

export function stopPeriodicChecks(ctx: ProjectContext): void {
  const t = timersByProject.get(ctx.rootPath);
  if (t) {
    clearInterval(t);
    timersByProject.delete(ctx.rootPath);
  }
}
