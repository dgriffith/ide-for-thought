/**
 * SHACL shapes as inspections (#2642): reading a shapes file into the checks
 * it declares, and refusing one that could do anything but read.
 *
 * A check is a top-level `sh:NodeShape` with a target (`sh:targetClass`,
 * `sh:targetNode`, `sh:targetSubjectsOf`, `sh:targetObjectsOf`, `sh:target`).
 * What it says about itself is standard SHACL where SHACL has a term, and
 * Minerva's own annotations where it doesn't:
 *
 * | Inspection field | From |
 * |---|---|
 * | label, description | `sh:name`, `sh:description` |
 * | severity | `sh:severity`: `sh:Info` → info, `sh:Warning` → warning, `sh:Violation` (the default) → concern |
 * | message | `sh:message` — `{$this}` is the focus node's label |
 * | type | `minerva:inspectionId` (stock shapes); `plugin:<id>/<shape name>` (a plugin's); `thoughtbase:<shape name>` (a thoughtbase's own, #2874) |
 * | group | `minerva:inspectionGroup`: notes, links, sources, arguments; a plugin's defaults to plugins, a thoughtbase's to thoughtbase |
 * | suggested action | `minerva:suggestedAction` |
 *
 * **Read-only by construction.** A shape's SPARQL (`sh:select`, `sh:ask`) runs
 * in the validator's own Comunica, whose build ships SPARQL Update actors.
 * So every query in a file is parsed here, with the parser Comunica itself
 * uses, and the whole file is refused unless each is a SELECT or an ASK. The
 * run also hands the validator a dataset that throws on any write
 * (`run.ts`), so a query that got past this still couldn't change the graph.
 */
import { Parser as TurtleParser, type Quad } from 'n3';
import { Parser as SparqlParser } from '@traqula/parser-sparql-1-1';
import type { InspectionGroup, InspectionSeverity } from '../../../shared/inspections';

export const SH = 'http://www.w3.org/ns/shacl#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const MINERVA = 'https://minerva.dev/ontology#';

/** The largest shapes file read, in bytes. */
export const MAX_SHAPES_FILE_BYTES = 256 * 1024;
/** The most checks one file may declare. */
export const MAX_CHECKS_PER_FILE = 32;

const TARGETS = ['targetClass', 'targetNode', 'targetSubjectsOf', 'targetObjectsOf', 'target'].map((t) => SH + t);
const GROUPS: readonly InspectionGroup[] = ['notes', 'links', 'sources', 'arguments', 'plugins', 'thoughtbase'];
const SEVERITIES: Readonly<Record<string, InspectionSeverity>> = {
  [`${SH}Info`]: 'info',
  [`${SH}Warning`]: 'warning',
  [`${SH}Violation`]: 'concern',
};

/** Where a shapes file came from: one of Minerva's own, a plugin's, or the thoughtbase's (#2874). */
export type ShapesOrigin = { kind: 'stock' } | { kind: 'plugin'; id: string; name: string } | { kind: 'thoughtbase' };

/** One inspection a shape declares. */
export interface ShaclCheck {
  /** The inspection type its findings carry, and the switch that turns it off. */
  type: string;
  /** The `sh:NodeShape` it validates with. */
  shape: string;
  label: string;
  description: string;
  group: InspectionGroup;
  severity: InspectionSeverity;
  /** The shape's own `sh:message`, used when a result carries none. */
  message: string | null;
  suggestedAction: string | null;
  plugin?: { id: string; name: string };
}

/** A shapes file, read: its quads (the validator's shapes graph) and the checks in it. */
export interface ShapesFile {
  quads: Quad[];
  checks: ShaclCheck[];
}

export type ShapesFileResult = { ok: true; file: ShapesFile } | { ok: false; problems: string[] };

/** The part of an IRI after its last `#` or `/`: a shape's name. */
function localName(iri: string): string {
  return iri.replace(/^.*[#/]/, '');
}

/**
 * Read a shapes file. A file with any problem is refused whole — the same
 * rule as every other plugin contribution — and every problem is reported.
 */
export function parseShapesFile(turtle: string, origin: ShapesOrigin): ShapesFileResult {
  if (Buffer.byteLength(turtle, 'utf8') > MAX_SHAPES_FILE_BYTES) {
    return { ok: false, problems: [`it's over ${MAX_SHAPES_FILE_BYTES} bytes`] };
  }
  let quads: Quad[];
  try {
    quads = new TurtleParser().parse(turtle);
  } catch (e) {
    return { ok: false, problems: [`it isn't valid Turtle: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const problems = vetQueries(quads);

  const objects = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object);
  const first = (s: string, p: string) => objects(s, p)[0]?.value;
  const shapes = [...new Set(quads
    .filter((q) => q.predicate.value === RDF_TYPE && q.object.value === `${SH}NodeShape` && q.subject.termType === 'NamedNode')
    .map((q) => q.subject.value))]
    .filter((s) => TARGETS.some((t) => objects(s, t).length > 0));
  if (shapes.length === 0) problems.push('it declares no sh:NodeShape with a target (sh:targetClass, sh:targetNode, …), so no inspection');
  if (shapes.length > MAX_CHECKS_PER_FILE) problems.push(`it declares ${shapes.length} shapes with targets; at most ${MAX_CHECKS_PER_FILE}`);

  const checks: ShaclCheck[] = [];
  for (const shape of shapes) {
    const name = localName(shape);
    let type: string;
    if (origin.kind === 'stock') {
      const id = first(shape, `${MINERVA}inspectionId`);
      if (!id) { problems.push(`${shape} has no minerva:inspectionId`); continue; }
      type = id;
    } else {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) { problems.push(`the shape <${shape}> needs a name of letters, digits, _ and -, starting with a letter`); continue; }
      type = origin.kind === 'plugin' ? `plugin:${origin.id}/${name}` : `thoughtbase:${name}`;
    }
    if (checks.some((c) => c.type === type)) { problems.push(`two shapes are the inspection "${type}"`); continue; }
    const severityIri = first(shape, `${SH}severity`) ?? `${SH}Violation`;
    const severity = SEVERITIES[severityIri];
    if (!severity) { problems.push(`${name}'s sh:severity is <${severityIri}>; use sh:Info, sh:Warning or sh:Violation`); continue; }
    const groupRaw = first(shape, `${MINERVA}inspectionGroup`) ?? (origin.kind === 'plugin' ? 'plugins' : origin.kind === 'thoughtbase' ? 'thoughtbase' : undefined);
    const group = GROUPS.find((g) => g === groupRaw);
    if (!group) { problems.push(`${name}'s minerva:inspectionGroup is ${JSON.stringify(groupRaw ?? null)}; use ${GROUPS.join(', ')}`); continue; }
    checks.push({
      type, shape, severity, group,
      label: first(shape, `${SH}name`) ?? name,
      description: first(shape, `${SH}description`) ?? '',
      message: first(shape, `${SH}message`) ?? null,
      suggestedAction: first(shape, `${MINERVA}suggestedAction`) ?? null,
      ...(origin.kind === 'plugin' ? { plugin: { id: origin.id, name: origin.name } } : {}),
    });
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, file: { quads, checks } };
}

/**
 * Every `sh:select` must parse as a SELECT and every `sh:ask` as an ASK — and
 * nothing else in the file is SPARQL the validator runs. An Update, or text
 * that doesn't parse, refuses the file. The prefixes the file declares
 * (`sh:declare`, which `sh:prefixes` points at) are the query's, as the
 * validator gives them.
 */
function vetQueries(quads: readonly Quad[]): string[] {
  const problems: string[] = [];
  const parser = new SparqlParser();
  const prologue = declaredPrefixes(quads).map(([p, ns]) => `PREFIX ${p}: <${ns}>`).join('\n');
  for (const q of quads) {
    const want = q.predicate.value === `${SH}select` ? 'select' : q.predicate.value === `${SH}ask` ? 'ask' : null;
    if (!want) continue;
    const kind = want === 'select' ? 'sh:select' : 'sh:ask';
    let parsed: { type?: string; subType?: string };
    try {
      parsed = parser.parse(`${prologue}\n${q.object.value}`);
    } catch (e) {
      problems.push(`a ${kind} isn't valid SPARQL: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
      continue;
    }
    if (parsed.type !== 'query' || parsed.subType !== want) {
      problems.push(`a ${kind} must be ${want === 'ask' ? 'an ASK' : 'a SELECT'} query; a shape can only read the graph`);
    }
  }
  return problems;
}

/** The prefixes a file declares for its SPARQL: each `sh:declare [ sh:prefix "x" ; sh:namespace "…" ]`. */
function declaredPrefixes(quads: readonly Quad[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const d of quads.filter((q) => q.predicate.value === `${SH}declare`)) {
    const of = (p: string) => quads.find((q) => q.subject.equals(d.object) && q.predicate.value === SH + p)?.object.value;
    const prefix = of('prefix');
    const ns = of('namespace');
    if (prefix !== undefined && ns !== undefined && /^[A-Za-z][\w-]*$|^$/.test(prefix) && !/[<>\s]/.test(ns)) out.push([prefix, ns]);
  }
  return out;
}
