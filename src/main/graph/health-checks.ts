import { queryGraph, headingsFor } from './index';
import type { ProjectContext } from '../project-context-types';
import { LINK_TYPES } from '../../shared/link-types';
import { DAY_MS } from './queries';

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
}

const lastResultsByProject = new Map<string, Inspection[]>();
let running = false;

export function getInspections(ctx: ProjectContext): Inspection[] {
  return lastResultsByProject.get(ctx.rootPath) ?? [];
}

export function isRunning(): boolean {
  return running;
}

// ── Run All Checks ─────────────────────────────────────────────────────────

export async function runAllChecks(ctx: ProjectContext): Promise<Inspection[]> {
  if (running) return lastResultsByProject.get(ctx.rootPath) ?? [];
  running = true;

  try {
    const results = await Promise.all([
      checkUnsupportedClaims(ctx),
      checkStaleness(ctx, 30), // 30 days
      checkEvidenceGaps(ctx),
      checkContradictions(ctx),
      checkInvalidDois(ctx),
      checkSourcesMissingMetadata(ctx),
      checkLongUnresolvedStubs(ctx, 30), // 30 days
      checkCitedUnreadSources(ctx),
      checkDuplicateSources(ctx),
      checkBrokenLinks(ctx),
    ]);
    const flat = results.flat();
    lastResultsByProject.set(ctx.rootPath, flat);
    return flat;
  } finally {
    running = false;
  }
}

// ── Individual Checks ──────────────────────────────────────────────────────

async function checkUnsupportedClaims(ctx: ProjectContext): Promise<Inspection[]> {
  const results = await queryGraph(ctx, `
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    SELECT ?claim ?label WHERE {
      ?claim a thought:Claim .
      ?claim thought:label ?label .
      FILTER NOT EXISTS { ?other thought:supports ?claim }
    }
  `);

  return (results.results as Record<string, string>[]).map((r, i) => ({
    id: `unsupported-${i}`,
    type: 'unsupported_claim',
    severity: 'warning' as const,
    nodeUri: r.claim!,
    nodeLabel: r.label!,
    message: `Claim "${r.label}" has no supporting evidence`,
    suggestedAction: 'Add grounds or evidence that supports this claim',
  }));
}

async function checkStaleness(ctx: ProjectContext, thresholdDays: number): Promise<Inspection[]> {
  const cutoff = new Date(Date.now() - thresholdDays * DAY_MS).toISOString();

  const results = await queryGraph(ctx, `
    PREFIX dc: <http://purl.org/dc/terms/>
    PREFIX minerva: <https://minerva.dev/ontology#>
    SELECT ?note ?title ?modified WHERE {
      ?note a minerva:Note .
      ?note dc:title ?title .
      ?note dc:modified ?modified .
      FILTER(?modified < "${cutoff}"^^<http://www.w3.org/2001/XMLSchema#dateTime>)
    }
    ORDER BY ?modified
    LIMIT 20
  `);

  return (results.results as Record<string, string>[]).map((r, i) => ({
    id: `stale-${i}`,
    type: 'stale_note',
    severity: 'info' as const,
    nodeUri: r.note!,
    nodeLabel: r.title!,
    message: `"${r.title}" hasn't been modified since ${r.modified!.split('T')[0]}`,
    suggestedAction: 'Review whether this note is still current',
  }));
}

async function checkEvidenceGaps(ctx: ProjectContext): Promise<Inspection[]> {
  const inspections: Inspection[] = [];

  // Claims with grounds but no warrant
  const noWarrant = await queryGraph(ctx, `
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    SELECT ?claim ?label WHERE {
      ?claim a thought:Claim .
      ?claim thought:label ?label .
      ?grounds thought:supports ?claim .
      ?grounds a thought:Grounds .
      FILTER NOT EXISTS {
        ?warrant thought:supports ?claim .
        ?warrant a thought:Warrant .
      }
    }
  `);

  for (const [i, r] of (noWarrant.results as Record<string, string>[]).entries()) {
    inspections.push({
      id: `no-warrant-${i}`,
      type: 'missing_warrant',
      severity: 'warning',
      nodeUri: r.claim!,
      nodeLabel: r.label!,
      message: `Claim "${r.label}" has grounds but no warrant connecting them`,
      suggestedAction: 'Add a warrant explaining why the grounds support this claim',
    });
  }

  // Warrants with no backing
  const noBacking = await queryGraph(ctx, `
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    SELECT ?warrant ?label WHERE {
      ?warrant a thought:Warrant .
      ?warrant thought:label ?label .
      FILTER NOT EXISTS {
        ?backing thought:supports ?warrant .
        ?backing a thought:Backing .
      }
    }
  `);

  for (const [i, r] of (noBacking.results as Record<string, string>[]).entries()) {
    inspections.push({
      id: `no-backing-${i}`,
      type: 'missing_backing',
      severity: 'info',
      nodeUri: r.warrant!,
      nodeLabel: r.label!,
      message: `Warrant "${r.label}" has no backing — why should we accept this reasoning principle?`,
      suggestedAction: 'Add backing that supports this warrant',
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
    PREFIX bibo: <http://purl.org/ontology/bibo/>
    PREFIX dc: <http://purl.org/dc/terms/>
    PREFIX minerva: <https://minerva.dev/ontology#>
    SELECT ?source ?sourceId ?title ?doi WHERE {
      ?source minerva:sourceId ?sourceId .
      ?source bibo:doi ?doi .
      OPTIONAL { ?source dc:title ?title }
    }
  `);

  return (results.results as Record<string, string>[]).flatMap((r, i) => {
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
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    SELECT ?a ?aLabel ?b ?bLabel WHERE {
      ?a thought:contradicts ?b .
      ?a thought:hasStatus thought:established .
      ?b thought:hasStatus thought:established .
      ?a thought:label ?aLabel .
      ?b thought:label ?bLabel .
    }
  `);

  return (results.results as Record<string, string>[]).map((r, i) => ({
    id: `contradiction-${i}`,
    type: 'contradiction',
    severity: 'concern' as const,
    nodeUri: r.a!,
    nodeLabel: r.aLabel!,
    message: `Established claim "${r.aLabel}" contradicts established claim "${r.bLabel}"`,
    suggestedAction: 'Review both claims — at least one needs to be revised or its status changed',
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
    PREFIX minerva: <https://minerva.dev/ontology#>
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    PREFIX dc: <http://purl.org/dc/terms/>
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

  return (results.results as Record<string, string>[]).map((r, i) => {
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
    PREFIX minerva: <https://minerva.dev/ontology#>
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    PREFIX dc: <http://purl.org/dc/terms/>
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

  return (results.results as Record<string, string>[]).map((r, i) => {
    const label = r.title || r.sourceId!;
    return {
      id: `stub-aged-${i}`,
      type: 'stub_aged',
      severity: 'info' as const,
      nodeUri: r.source!,
      nodeLabel: label,
      message: `Stub "${label}" has been unresolved since ${r.modified!.split('T')[0]}.`,
      suggestedAction: 'Right-click the source and run "Resolve to full source", or hand-edit meta.ttl.',
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
    PREFIX minerva: <https://minerva.dev/ontology#>
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    PREFIX dc: <http://purl.org/dc/terms/>
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

  return (results.results as Record<string, string>[]).map((r, i) => {
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
    PREFIX minerva: <https://minerva.dev/ontology#>
    PREFIX bibo: <http://purl.org/ontology/bibo/>
    PREFIX dc: <http://purl.org/dc/terms/>
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
  for (const [i, r] of (dupDois.results as Record<string, string>[]).entries()) {
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
    });
  }

  // Duplicate URIs (lowercased, trailing slash normalised).
  const dupUris = await queryGraph(ctx, `
    PREFIX minerva: <https://minerva.dev/ontology#>
    PREFIX bibo: <http://purl.org/ontology/bibo/>
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
  for (const [i, r] of (dupUris.results as Record<string, string>[]).entries()) {
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
      PREFIX minerva: <https://minerva.dev/ontology#>
      SELECT ?path WHERE { ?n minerva:relativePath ?path . ?n a minerva:Note }
    `),
    queryGraph(ctx, `
      PREFIX minerva: <https://minerva.dev/ontology#>
      SELECT ?id WHERE { ?s minerva:sourceId ?id }
    `),
    queryGraph(ctx, `
      PREFIX minerva: <https://minerva.dev/ontology#>
      SELECT ?id WHERE { ?e minerva:excerptId ?id }
    `),
  ]);
  const validNotes = new Set((notesRes.results as { path: string }[]).map((r) => r.path));
  const validSources = new Set((sourcesRes.results as { id: string }[]).map((r) => r.id));
  const validExcerpts = new Set((excerptsRes.results as { id: string }[]).map((r) => r.id));

  // Walk every link triple — across every typed-link predicate.
  const linksRes = await queryGraph(ctx, `
    PREFIX minerva: <https://minerva.dev/ontology#>
    PREFIX thought: <https://minerva.dev/ontology/thought#>
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
    const ins = inspectionForBrokenLink(ctx, row, classified, validNotes, validSources, validExcerpts, counter);
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
  /** The identifier portion — relativePath for notes (with `.md`),
   *  sourceId / excerptId for the others. URL-decoded. */
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
    // Note URIs in the indexer carry a `.md` suffix on the path
    // string (e.g. `path/foo.md`); add it for matching.
    return { kind: 'note', id: id.endsWith('.md') ? id : `${id}.md`, anchor };
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
  validNotes: Set<string>,
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
      message: `Note "${row.sourcePath}" quotes an unknown excerpt: ${classified.id}`,
      suggestedAction: 'Create the excerpt from the source viewer, or fix the `[[quote::id]]` target.',
    };
  }
  if (classified.kind === 'note') {
    if (!validNotes.has(classified.id)) {
      const linkText = classified.anchor
        ? `${classified.id.replace(/\.md$/, '')}#${classified.anchor}`
        : classified.id.replace(/\.md$/, '');
      return {
        id: `broken-note-${index}`,
        type: 'broken_note_link',
        severity: 'warning',
        nodeUri: row.source,
        nodeLabel: row.sourcePath,
        message: `Note "${row.sourcePath}" links to a missing note: [[${linkText}]]`,
        suggestedAction: 'Create the target note, fix the spelling, or remove the link.',
      };
    }
    // Note exists. Check anchor when one was specified.
    // Block-id anchors (`#^id`) intentionally skipped — they're
    // scattered through the note body, not stored as triples.
    if (classified.anchor && !classified.anchor.startsWith('^')) {
      const headings = headingsFor(ctx, classified.id);
      const found = headings.some((h) => h.slug === classified.anchor);
      if (!found) {
        const stem = classified.id.replace(/\.md$/, '');
        return {
          id: `broken-anchor-${index}`,
          type: 'broken_anchor_link',
          severity: 'warning',
          nodeUri: row.source,
          nodeLabel: row.sourcePath,
          message: `Note "${row.sourcePath}" links to a missing heading: [[${stem}#${classified.anchor}]]`,
          suggestedAction: 'Add the heading to the target note, fix the anchor slug, or remove the `#…` part.',
        };
      }
    }
  }
  return null;
}

// ── Timer ──────────────────────────────────────────────────────────────────

const timersByProject = new Map<string, ReturnType<typeof setInterval>>();

export function startPeriodicChecks(ctx: ProjectContext, intervalMs: number = 5 * 60 * 1000): void {
  stopPeriodicChecks(ctx);
  const timer = setInterval(() => { void runAllChecks(ctx); }, intervalMs);
  timersByProject.set(ctx.rootPath, timer);
}

export function stopPeriodicChecks(ctx: ProjectContext): void {
  const t = timersByProject.get(ctx.rootPath);
  if (t) {
    clearInterval(t);
    timersByProject.delete(ctx.rootPath);
  }
}
