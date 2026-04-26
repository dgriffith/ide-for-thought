import { queryGraph } from './index';
import type { ProjectContext } from '../project-context-types';

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
    nodeUri: r.claim,
    nodeLabel: r.label,
    message: `Claim "${r.label}" has no supporting evidence`,
    suggestedAction: 'Add grounds or evidence that supports this claim',
  }));
}

async function checkStaleness(ctx: ProjectContext, thresholdDays: number): Promise<Inspection[]> {
  const cutoff = new Date(Date.now() - thresholdDays * 86400000).toISOString();

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
    nodeUri: r.note,
    nodeLabel: r.title,
    message: `"${r.title}" hasn't been modified since ${r.modified.split('T')[0]}`,
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
      nodeUri: r.claim,
      nodeLabel: r.label,
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
      nodeUri: r.warrant,
      nodeLabel: r.label,
      message: `Warrant "${r.label}" has no backing — why should we accept this reasoning principle?`,
      suggestedAction: 'Add backing that supports this warrant',
    });
  }

  return inspections;
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
    nodeUri: r.a,
    nodeLabel: r.aLabel,
    message: `Established claim "${r.aLabel}" contradicts established claim "${r.bLabel}"`,
    suggestedAction: 'Review both claims — at least one needs to be revised or its status changed',
  }));
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
