/**
 * @vitest-environment node
 *
 * `docs/thought-ontology.md` matches the ontology it describes (#2264,
 * epic #2268).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `src/shared/ontology-thought.ttl` was the best-commented artifact in the
 * repository and the least discoverable: 92 classes and 104 properties, every
 * one carrying an `rdfs:comment`, and not one inbound prose reference anywhere
 * under `docs/` or `website/docs/`. #2264 wrote the overview. This keeps it
 * from becoming the other failure mode — a confident document describing an
 * ontology that has moved on.
 *
 * `tests/architecture/ontology-terms.test.ts` is the sibling, and the division
 * is deliberate: that one scans `src/` and asks "does the code name a term the
 * ontology doesn't declare?". This one scans one doc and asks the question in
 * both directions:
 *
 *   1. **doc → ontology.** Every `thought:` / `minerva:` CURIE the document
 *      names is a declared term. Catches a typo, a term invented in prose, or
 *      a term that was removed from the Turtle after the doc cited it. (This
 *      direction is what `ontology-terms.test.ts` does for `src/`; docs are
 *      out of its scope on purpose — it reads `git ls-files src`.)
 *
 *   2. **ontology → doc.** Every class, property and named individual the
 *      thought ontology declares is named somewhere in the document. This is
 *      the `config-roots-doc.test.ts` shape: a hand-maintained inventory that
 *      nothing checks is a document that tells you something false with
 *      confidence. Add a class to the Turtle and this fails until the overview
 *      mentions it.
 *
 * ── Scope, honestly ─────────────────────────────────────────────────────────
 * Direction 2 checks PRESENCE, not accuracy — a term whose description in the
 * doc is wrong still passes. Naming the term is the part that actually gets
 * forgotten, and the alternative (asserting prose against `rdfs:comment`) would
 * either be a byte-for-byte duplication of the Turtle or unfalsifiable.
 *
 * It covers `ontology-thought.ttl` only. `ontology.ttl` (the `minerva:` core)
 * has no prose overview yet; when one lands, point a second `describe` block at
 * it rather than widening this one, because the two files have different
 * audiences.
 *
 * Nothing here checks the *website* docs. `website/docs/**` is generated from
 * `_content/` and has its own staleness snapshot.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'n3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DOC = 'docs/thought-ontology.md';
const THOUGHT_TTL = 'src/shared/ontology-thought.ttl';
/** Direction 1 resolves against BOTH files — the doc legitimately names
 *  `minerva:Note`, `minerva:supports` and the typed-object class metadata. */
const ONTOLOGY_FILES = ['src/shared/ontology.ttl', THOUGHT_TTL] as const;

/**
 * Prefixes whose terms this test reasons about.
 *
 * `thought` and `minerva` are the namespaces the two files are authoritative
 * for. The other three are external vocabularies the thought ontology
 * re-annotates for `describe_graph_schema`'s benefit (21 of the Source
 * predicates are Dublin Core / BIBO / schema.org terms, not Minerva ones) —
 * they appear as SUBJECTS in the Turtle, so direction 2 would otherwise demand
 * the doc name them without direction 1 being able to validate one.
 */
const NAMESPACES: Record<string, string> = {
  minerva: 'https://minerva.dev/ontology#',
  thought: 'https://minerva.dev/ontology/thought#',
  dc: 'http://purl.org/dc/terms/',
  bibo: 'http://purl.org/ontology/bibo/',
  schema: 'http://schema.org/',
};

/** Namespaces direction 1 polices. A `dc:`/`bibo:`/`schema:` CURIE in the doc
 *  may legitimately be a term neither file declares (`dc:terms` vocabulary is
 *  not ours to enumerate), so only our own two are asserted. */
const OWNED_PREFIXES = ['minerva', 'thought'] as const;

/** Same CURIE shape `ontology-terms.test.ts` uses, so the two agree on what
 *  counts as a prefixed name. The lookbehind keeps `urn:minerva:asset:…` and
 *  `.minerva/graph.ttl` paths out. */
const CURIE = /(?<![A-Za-z0-9_:#/-])(minerva|thought):([A-Za-z_][A-Za-z0-9_-]*)/g;

/** `minerva:meta-<key>` is the open-ended frontmatter fallthrough — the local
 *  names are whatever the user typed, so they can't be enumerated. */
const DYNAMIC_LOCAL_NAME = /^meta-/;

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf-8');
}

function toCurie(iri: string): string | null {
  for (const [prefix, base] of Object.entries(NAMESPACES)) {
    if (iri.startsWith(base) && iri.length > base.length) {
      return `${prefix}:${iri.slice(base.length)}`;
    }
  }
  return null;
}

/** Every term declared as a subject across both ontology files. */
function declaredTerms(): Set<string> {
  const declared = new Set<string>();
  for (const relative of ONTOLOGY_FILES) {
    for (const quad of new Parser().parse(read(relative))) {
      if (quad.subject.termType !== 'NamedNode') continue;
      const term = toCurie(quad.subject.value);
      if (term) declared.add(term);
    }
  }
  return declared;
}

/**
 * Terms the THOUGHT ontology declares, as a sorted list — the set direction 2
 * demands the doc cover. Subjects only, which is exactly right: a class, a
 * property and a status individual are all subjects of their own description,
 * and nothing else in the file is.
 */
function thoughtOntologyTerms(): string[] {
  const declared = new Set<string>();
  for (const quad of new Parser().parse(read(THOUGHT_TTL))) {
    if (quad.subject.termType !== 'NamedNode') continue;
    const term = toCurie(quad.subject.value);
    if (term) declared.add(term);
  }
  return [...declared].sort();
}

/** Terms the doc names, in the two namespaces we own. */
function docTerms(): string[] {
  const doc = read(DOC);
  const out = new Set<string>();
  for (const m of doc.matchAll(CURIE)) out.add(`${m[1]}:${m[2]}`);
  return [...out].sort();
}

/** Does the doc name this term? Bounded so `thought:archivedAt` doesn't count
 *  as a mention of `thought:archived`. */
function docNames(term: string): boolean {
  return new RegExp(`${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`)
    .test(read(DOC));
}

describe('docs/thought-ontology.md is checked against the ontology (#2264)', () => {
  it('the document exists and the ontology parses', () => {
    // Explicit and first, so a missing file or a Turtle syntax error reports as
    // itself rather than as a mystery inside an assertion below.
    expect(fs.existsSync(path.join(ROOT, DOC))).toBe(true);
    expect(() => declaredTerms()).not.toThrow();
  });

  it('finds a non-trivial number of terms on both sides', () => {
    // Guards the scanners themselves: a broken prefix constant, a parser
    // change, or a renamed doc would otherwise let both assertions below pass
    // vacuously (nothing to compare, so nothing to disagree about).
    expect(thoughtOntologyTerms().length).toBeGreaterThan(150);
    expect(docTerms().length).toBeGreaterThan(100);
  });

  it('every thought:/minerva: term the doc names is declared in an ontology file', () => {
    const declared = declaredTerms();
    const undeclared = docTerms().filter((term) => {
      if (declared.has(term)) return false;
      const [prefix, local] = term.split(':') as [string, string];
      if (!(OWNED_PREFIXES as readonly string[]).includes(prefix)) return false;
      return !DYNAMIC_LOCAL_NAME.test(local);
    });
    expect(
      undeclared,
      undeclared.length === 0 ? '' :
        `${DOC} names ${undeclared.length} term(s) that no ontology file ` +
        `declares:\n  ${undeclared.join('\n  ')}\n\n` +
        'Fix the typo, declare the term, or stop citing a term that was removed.',
    ).toEqual([]);
  });

  it('every term the thought ontology declares is named in the doc', () => {
    const missing = thoughtOntologyTerms().filter((term) => !docNames(term));
    expect(
      missing,
      missing.length === 0 ? '' :
        `${THOUGHT_TTL} declares ${missing.length} term(s) that ${DOC} never ` +
        `names:\n  ${missing.join('\n  ')}\n\n` +
        `Add them to ${DOC}. The overview is meant to be a complete map of the ` +
        'vocabulary — a term the document silently omits is a term nobody ' +
        'reading it will know exists.',
    ).toEqual([]);
  });
});
