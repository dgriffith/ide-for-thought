/**
 * Checking a thoughtbase's own vocabulary before it joins the graph (#2788).
 *
 * A file in `.minerva/ontology/` is someone else's input once a thoughtbase is
 * shared, and what it declares goes three places: the graph, every SPARQL
 * query's prologue (its prefixes) and the schema the model reads. So a file is
 * either accepted whole or refused whole, and a refusal names each problem:
 *
 * - **Additive only.** It may not describe a built-in term — anything in
 *   Minerva's own namespaces (`minerva:`, `thought:`, `types:`) or declared in
 *   the bundled ontology — and may not bind a standard prefix name to a
 *   different IRI. A user `skos:` pointing elsewhere would quietly break every
 *   query that uses it (#2388). Binding the same IRI is fine.
 * - **No contradictions** (the rule `ontology-terms.test.ts` applies to the
 *   built-ins, #2345): one term with two `rdfs:range`s or `rdfs:domain`s, or
 *   two `rdfs:label`s / `rdfs:comment`s in the same language — within the file
 *   or against a vocabulary already accepted. Two prefixes of one name, too.
 * - **Safe to splice.** A prefix becomes a `PREFIX name: <iri>` line in front
 *   of every query, so the name must be a SPARQL prefix name and the IRI
 *   absolute, with none of the characters that would end the `<…>` early.
 * - **Bounded:** {@link MAX_VOCABULARY_BYTES} per file.
 *
 * Pure: text in, verdict out. Reading the folder and loading the graph is
 * `user-ontology.ts`.
 */
import { Parser, type Quad } from 'n3';
import ONTOLOGY_TTL from '../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../shared/ontology-thought.ttl?raw';
import { STANDARD_PREFIXES } from './state';
import type { VocabularyPrefix, VocabularyStatus, VocabularyTerm } from '../../shared/ontology-vocabularies';

/** One vocabulary file's size cap. */
export const MAX_VOCABULARY_BYTES = 1024 * 1024;

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF_TYPE = `${RDF_NS}type`;
const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel';

const CLASS_TYPES = new Set([`${RDFS}Class`, `${OWL}Class`]);
const PROPERTY_TYPES = new Set([
  `${RDF_NS}Property`, `${OWL}ObjectProperty`, `${OWL}DatatypeProperty`, `${OWL}AnnotationProperty`,
]);

/** One value per term; for labels and comments, one per language. */
const UNIQUE_PER_TERM = [
  { iri: `${RDFS}range`, name: 'rdfs:range', perLanguage: false },
  { iri: `${RDFS}domain`, name: 'rdfs:domain', perLanguage: false },
  { iri: `${RDFS}label`, name: 'rdfs:label', perLanguage: true },
  { iri: `${RDFS}comment`, name: 'rdfs:comment', perLanguage: true },
] as const;

/** Minerva's own namespaces: nothing a thoughtbase imports may describe a term in them. */
const MINERVA_NAMESPACES = STANDARD_PREFIXES
  .filter(([name]) => name === 'minerva' || name === 'thought' || name === 'types')
  .map(([, iri]) => iri);

/** SPARQL's PN_PREFIX, ASCII: a letter, then letters, digits, `_`, `-`, `.`, not ending in `.`. */
const PREFIX_NAME = /^(?:[A-Za-z](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?)?$/;
/** An absolute IRI that can sit inside `<…>` in a SPARQL prologue. */
const SPLICEABLE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|^`\\]*$/;

let builtInSubjects: Set<string> | null = null;

/** Every IRI the bundled ontology files declare as a subject. */
function builtInTerms(): Set<string> {
  if (builtInSubjects) return builtInSubjects;
  const subjects = new Set<string>();
  for (const ttl of [ONTOLOGY_TTL, THOUGHT_ONTOLOGY_TTL]) {
    try {
      for (const q of new Parser().parse(ttl)) {
        if (q.subject.termType === 'NamedNode') subjects.add(q.subject.value);
      }
    } catch { /* a broken bundled file is ontology-terms.test.ts's to report */ }
  }
  builtInSubjects = subjects;
  return subjects;
}

function isBuiltIn(iri: string): boolean {
  return MINERVA_NAMESPACES.some((ns) => iri.startsWith(ns)) || builtInTerms().has(iri);
}

/**
 * What the vocabularies accepted so far have claimed — the prefixes they bind
 * and the one-per-term values they set — so the next file is checked against
 * them as well as against itself.
 */
export interface AcceptedVocabularies {
  prefixes: Map<string, { iri: string; file: string }>;
  unique: Map<string, { value: string; file: string }>;
}

export function emptyAccepted(): AcceptedVocabularies {
  return { prefixes: new Map(), unique: new Map() };
}

export interface CheckedVocabulary {
  status: VocabularyStatus;
  /** The triples to load — empty when refused. */
  quads: Quad[];
  /** Its prefixes as they'll be injected: named, and not already standard. */
  injected: VocabularyPrefix[];
  /** One-per-term values it sets, for {@link acceptVocabulary}. */
  unique: Map<string, string>;
}

/** Check one vocabulary file against itself, the built-ins and `accepted`. Doesn't touch `accepted`. */
export function checkVocabulary(file: string, text: string, accepted: AcceptedVocabularies): CheckedVocabulary {
  const refuse = (problems: string[]): CheckedVocabulary =>
    ({ status: { file, ok: false, problems }, quads: [], injected: [], unique: new Map() });

  const bytes = Buffer.byteLength(text, 'utf-8');
  if (bytes > MAX_VOCABULARY_BYTES) {
    return refuse([`It is ${Math.ceil(bytes / 1024)} KB; a vocabulary may be at most ${MAX_VOCABULARY_BYTES / 1024} KB.`]);
  }

  const problems: string[] = [];
  const declared = new Map<string, string>();
  let quads: Quad[];
  try {
    // No quad callback: the parse is synchronous and returns the quads.
    quads = new Parser({ format: 'text/turtle' }).parse(text, null, (name, iri) => {
      const before = declared.get(name);
      if (before !== undefined && before !== iri.value) {
        problems.push(`It declares the prefix ${name || '(empty)'}: twice, as <${before}> and <${iri.value}>.`);
      }
      declared.set(name, iri.value);
    });
  } catch (e) {
    return refuse([`It isn't valid Turtle: ${e instanceof Error ? e.message : String(e)}`]);
  }

  // ── Prefixes ──────────────────────────────────────────────────────────────
  const standard = new Map(STANDARD_PREFIXES);
  const injected: VocabularyPrefix[] = [];
  const notes: string[] = [];
  for (const [name, iri] of declared) {
    if (!PREFIX_NAME.test(name)) { problems.push(`The prefix name "${name}" isn't one SPARQL accepts.`); continue; }
    if (!SPLICEABLE_IRI.test(iri)) { problems.push(`The prefix ${name}: is bound to <${iri}>, which isn't an absolute IRI a query can use.`); continue; }
    if (name === '') {
      notes.push('The empty prefix ":" isn\'t added to queries; its terms work with a named prefix or written in full.');
      continue;
    }
    const std = standard.get(name);
    if (std !== undefined) {
      if (std !== iri) problems.push(`It binds the standard prefix ${name}: to <${iri}>; Minerva binds it to <${std}>.`);
      continue;
    }
    const other = accepted.prefixes.get(name);
    if (other && other.iri !== iri) {
      problems.push(`It binds ${name}: to <${iri}>; ${other.file} binds it to <${other.iri}>.`);
      continue;
    }
    injected.push({ prefix: name, iri });
  }

  // ── Terms ─────────────────────────────────────────────────────────────────
  const known: VocabularyPrefix[] = [
    ...STANDARD_PREFIXES.map(([prefix, iri]) => ({ prefix, iri })),
    ...[...declared].filter(([name]) => name !== '').map(([prefix, iri]) => ({ prefix, iri })),
  ];
  const curie = (iri: string) => toCurie(iri, known);
  const name = (iri: string) => curie(iri) ?? `<${iri}>`;

  const builtIns = new Set<string>();
  const relative = new Set<string>();
  const values = new Map<string, Set<string>>();
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object]) {
      if (term.termType === 'NamedNode' && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(term.value)) relative.add(term.value);
    }
    if (q.subject.termType !== 'NamedNode') continue;
    if (isBuiltIn(q.subject.value)) builtIns.add(q.subject.value);
    for (const rule of UNIQUE_PER_TERM) {
      if (q.predicate.value !== rule.iri) continue;
      const lang = rule.perLanguage && q.object.termType === 'Literal' ? q.object.language : '';
      const key = `${q.subject.value}\u0000${rule.name}\u0000${lang}`;
      const seen = values.get(key) ?? new Set<string>();
      seen.add(q.object.value);
      values.set(key, seen);
    }
  }
  for (const iri of [...relative].sort()) {
    problems.push(`<${iri}> is a relative IRI; write it in full, or give the file an @base.`);
  }
  for (const iri of [...builtIns].sort()) {
    problems.push(`It describes ${name(iri)}, a built-in term; a vocabulary can add terms, not change Minerva's.`);
  }
  const unique = new Map<string, string>();
  for (const [key, seen] of [...values].sort(([a], [b]) => a.localeCompare(b))) {
    const [subject, rule, lang] = key.split('\u0000') as [string, string, string];
    const where = lang ? ` (@${lang})` : '';
    if (seen.size > 1) {
      problems.push(`${name(subject)} has ${seen.size} different ${rule} values${where}: ${[...seen].map(quote).join(' | ')}.`);
      continue;
    }
    const value = [...seen][0]!;
    const other = accepted.unique.get(key);
    if (other && other.value !== value) {
      problems.push(`${name(subject)}'s ${rule}${where} is ${quote(value)}; ${other.file} says ${quote(other.value)}.`);
      continue;
    }
    unique.set(key, value);
  }

  if (problems.length > 0) return refuse(problems);

  return {
    status: { file, ok: true, prefixes: injected, ...summarize(quads, curie), triples: quads.length, notes },
    quads,
    injected,
    unique,
  };
}

/** Record an accepted vocabulary's claims, so the next file is checked against them. */
export function acceptVocabulary(accepted: AcceptedVocabularies, checked: CheckedVocabulary): void {
  const { file } = checked.status;
  for (const { prefix, iri } of checked.injected) accepted.prefixes.set(prefix, { iri, file });
  for (const [key, value] of checked.unique) accepted.unique.set(key, { value, file });
}

/** The classes and properties a vocabulary declares, each with its label. */
function summarize(
  quads: Quad[],
  curie: (iri: string) => string | undefined,
): { classes: VocabularyTerm[]; properties: VocabularyTerm[] } {
  const classes = new Set<string>();
  const properties = new Set<string>();
  const labels = new Map<string, { value: string; rank: number }>();
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode') continue;
    const s = q.subject.value;
    if (q.predicate.value === RDF_TYPE) {
      if (CLASS_TYPES.has(q.object.value)) classes.add(s);
      if (PROPERTY_TYPES.has(q.object.value)) properties.add(s);
    }
    if ((q.predicate.value === `${RDFS}label` || q.predicate.value === SKOS_PREF_LABEL) && q.object.termType === 'Literal') {
      // An untagged or English rdfs:label first, then any rdfs:label, then skos:prefLabel.
      const lang = q.object.language;
      const rank = (q.predicate.value === `${RDFS}label` ? 0 : 2) + (lang === '' || lang.startsWith('en') ? 0 : 1);
      const before = labels.get(s);
      if (!before || rank < before.rank) labels.set(s, { value: q.object.value, rank });
    }
  }
  const term = (iri: string): VocabularyTerm => {
    const c = curie(iri);
    const label = labels.get(iri)?.value;
    return { iri, ...(c ? { curie: c } : {}), ...(label ? { label } : {}) };
  };
  const byName = (a: VocabularyTerm, b: VocabularyTerm) => (a.curie ?? a.iri).localeCompare(b.curie ?? b.iri);
  return {
    classes: [...classes].map(term).sort(byName),
    properties: [...properties].map(term).sort(byName),
  };
}

/** `prefix:local` under the longest matching namespace, if the local part is a plain name. */
export function toCurie(iri: string, prefixes: readonly VocabularyPrefix[]): string | undefined {
  let best: VocabularyPrefix | undefined;
  for (const p of prefixes) {
    if (iri.startsWith(p.iri) && (!best || p.iri.length > best.iri.length)) best = p;
  }
  if (!best) return undefined;
  const local = iri.slice(best.iri.length);
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(local) ? `${best.prefix}:${local}` : undefined;
}

function quote(value: string): string {
  const short = value.length > 60 ? `${value.slice(0, 57)}…` : value;
  return `"${short.replace(/\s+/g, ' ')}"`;
}
