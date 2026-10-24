/**
 * Running SHACL shapes as inspections (#2642): validate the graph against a
 * check's shape and turn each result into a finding.
 *
 * The validator is `shacl-engine` (rdf-ext): SHACL Core plus SPARQL-based
 * constraints and targets, on Comunica 5 like `queryGraph`. It reads the same
 * N3 mirror `queryGraph` does, through a view that refuses every write.
 *
 * Three things it does that the spec alone wouldn't tell you:
 *
 * - **Subclasses come from the data.** SHACL says a target class's instances
 *   include its subclasses' — in the DATA graph — but the engine resolves
 *   `rdfs:subClassOf` within the SHAPES graph only. Minerva's type hierarchy
 *   (`types:Claim rdfs:subClassOf thought:Claim`, #2036) is data, so each run
 *   copies the data's `rdfs:subClassOf` triples into the shapes it validates
 *   with. They are a handful: one per declared type.
 * - **One validation per check.** A result names the shape that failed, which
 *   for a property constraint is the property shape, not the check's node
 *   shape; validating a check on its own is what makes every result its own.
 *   It also isolates checks: one that throws or runs long costs only itself.
 * - **The check's message wins.** A result carries the message of the shape
 *   that failed — for a property constraint, the property shape's, which
 *   without its own `sh:message` is the engine's wording ("Less than 1
 *   values"). A check's node shape `sh:message` is what a finding says, when
 *   it has one; otherwise the result's, which is how a SPARQL constraint's
 *   `{?var}` message comes through.
 * - **Messages read as text.** The engine fills a SPARQL constraint's
 *   `{?var}` with the term's N-Triples form; a finding shows an IRI as its
 *   label, and a literal as its quoted text without a datatype or language
 *   tag (`"Moon landing"`). `{$this}` is the focus node's bare label, for a
 *   message to quote or not.
 *
 * Bounded: a check that hasn't finished in `SHACL_CHECK_TIMEOUT_MS` is
 * reported as nothing and logged — the engine can't be cancelled, so its work
 * finishes unseen — and a check reports at most `SHACL_CHECK_MAX_FINDINGS`.
 */
import N3 from 'n3';
import type { Validator } from 'shacl-engine';
import type { Inspection } from '../../../shared/inspections';
import { logger } from '../../../shared/logger';
import type { ProjectContext } from '../../project-context-types';
import { ensureN3Cache, getState } from '../state';
import { queryGraphRows } from '../queries';
import type { ShaclCheck, ShapesFile } from './shapes';

/** How long one check may run before it reports nothing. */
export const SHACL_CHECK_TIMEOUT_MS = 10_000;
/** The most findings one check reports. */
export const SHACL_CHECK_MAX_FINDINGS = 200;

const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const WRITES = new Set(['add', 'addQuad', 'addQuads', 'delete', 'removeQuad', 'removeQuads', 'removeMatches', 'deleteGraph', 'import', 'remove', 'clear']);

/**
 * The engine, loaded on first use: it brings a Comunica build of its own, and
 * nothing at startup needs it — the first sweep runs after the window is up.
 */
let engine: Promise<{ Validator: typeof Validator; validations: unknown; targetResolvers: unknown }> | null = null;
function loadEngine() {
  engine ??= Promise.all([import('shacl-engine'), import('shacl-engine/sparql.js')])
    .then(([core, sparql]) => ({ Validator: core.Validator, validations: sparql.validations, targetResolvers: sparql.targetResolvers }));
  return engine;
}

/** The validator's RDF/JS factory: N3's, plus the dataset constructor it builds its report with. */
const factory = { ...N3.DataFactory, dataset: (quads?: Iterable<N3.Quad>) => new N3.Store(quads ? [...quads] : []) };

/** `store`, readable and nothing else: any write throws, so no shape can change the graph. */
export function readOnlyDataset(store: N3.Store): N3.Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && WRITES.has(prop)) {
        return () => { throw new Error('A SHACL shape tried to change the graph; shapes only read it.'); };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** A term in a message, as a reader sees it: an IRI's label, a literal's text. */
const NT_TERM = /<([^<>\s]+)>|"((?:[^"\\]|\\.)*)"(?:\^\^<[^<>\s]+>|@[A-Za-z0-9-]+)?/g;

function readable(message: string, labels: ReadonlyMap<string, string>): string {
  return message.replace(NT_TERM, (_m, iri: string | undefined, lit: string | undefined) => (iri !== undefined
    ? labels.get(iri) ?? iri
    : `"${(lit ?? '').replace(/\\(["\\nrt])/g, (_e, c: string) => ({ n: '\n', r: '\r', t: '\t' }[c] ?? c))}"`));
}

/** Every IRI a set of messages names, as N-Triples. */
function irisIn(messages: readonly string[]): string[] {
  return messages.flatMap((m) => [...m.matchAll(NT_TERM)].flatMap((x) => (x[1] ? [x[1]] : [])));
}

/** Labels and note paths for IRIs, in one query. */
async function describe(ctx: ProjectContext, iris: readonly string[]): Promise<Map<string, { label: string; notePath?: string }>> {
  const out = new Map<string, { label: string; notePath?: string }>();
  const safe = [...new Set(iris)].filter((i) => /^[^<>"{}|^`\\\s]+$/.test(i));
  if (safe.length === 0) return out;
  const result = await queryGraphRows(ctx, `
    SELECT ?n ?label ?path WHERE {
      VALUES ?n { ${safe.map((i) => `<${i}>`).join(' ')} }
      OPTIONAL { ?n thought:label ?tl }
      OPTIONAL { ?n dc:title ?dt }
      BIND(COALESCE(?tl, ?dt) AS ?label)
      OPTIONAL { ?n minerva:relativePath ?path }
    }`);
  for (const row of result.results as Array<Record<string, string | undefined>>) {
    const n = row.n;
    if (!n || out.has(n)) continue;
    out.set(n, { label: row.label ?? n.replace(/^.*[#/]/, ''), ...(row.path ? { notePath: row.path } : {}) });
  }
  return out;
}

interface ValidationResultLike {
  focusNode?: { value: string; termType: string };
  message?: Array<{ value: string }>;
}

/** Validate `dataset` against one check's shape, within the time limit. */
async function validateOne(validator: Validator, check: ShaclCheck, dataset: N3.Store): Promise<ValidationResultLike[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), SHACL_CHECK_TIMEOUT_MS); });
  try {
    const report = await Promise.race([
      validator.validate({ dataset }, [{ terms: [factory.namedNode(check.shape)] }]),
      timeout,
    ]);
    if (report === null) {
      logger('graph').warn(`inspection '${check.type}' took over ${SHACL_CHECK_TIMEOUT_MS}ms and reported nothing`);
      return [];
    }
    return report.results;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the checks `enabled` names from these shapes files against the graph.
 * A check that throws is logged and reports nothing; the others still run.
 */
export async function runShaclChecks(ctx: ProjectContext, files: readonly ShapesFile[], enabled: (type: string) => boolean): Promise<Inspection[]> {
  const state = getState(ctx);
  if (!state) return [];
  const store = await ensureN3Cache(state);
  const dataset = readOnlyDataset(store);
  const hierarchy = store.getQuads(null, RDFS_SUBCLASS, null, null);

  const found: Array<{ check: ShaclCheck; focus: string; raw: string | null }> = [];
  for (const file of files) {
    const checks = file.checks.filter((c) => enabled(c.type));
    if (checks.length === 0) continue;
    const { Validator, validations, targetResolvers } = await loadEngine();
    const shapes = new N3.Store([...file.quads, ...hierarchy]);
    const validator = new Validator(shapes, { factory, validations, targetResolvers });
    for (const check of checks) {
      try {
        const results = (await validateOne(validator, check, dataset)).slice(0, SHACL_CHECK_MAX_FINDINGS);
        for (const r of results) {
          if (!r.focusNode) continue;
          // The check's own sh:message is the finding's; without one, the
          // result's (a SPARQL constraint's, or the engine's own wording).
          found.push({ check, focus: r.focusNode.value, raw: check.message ?? r.message?.[0]?.value ?? null });
        }
      } catch (e) {
        logger('graph').warn(`inspection '${check.type}' couldn't run:`, e);
      }
    }
  }
  if (found.length === 0) return [];

  const described = await describe(ctx, [...found.map((f) => f.focus), ...irisIn(found.flatMap((f) => (f.raw ? [f.raw] : [])))]);
  const labels = new Map([...described].map(([iri, d]) => [iri, d.label]));
  // One finding per check and node: a node failing two constraints of one shape is one problem to look at.
  const seen = new Set<string>();
  const out: Inspection[] = [];
  for (const { check, focus, raw } of found) {
    const key = `${check.type}\u0000${focus}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = described.get(focus);
    const label = d?.label ?? focus.replace(/^.*[#/]/, '');
    const fill = (text: string) => readable(text, labels).replace(/\{\$this\}/g, label);
    out.push({
      id: `${check.type}-${out.length}`,
      type: check.type,
      severity: check.severity,
      nodeUri: focus,
      nodeLabel: label,
      message: fill(raw ?? check.label),
      ...(check.suggestedAction ? { suggestedAction: fill(check.suggestedAction) } : {}),
      ...(d?.notePath ? { notePath: d.notePath } : {}),
    });
  }
  return out;
}
