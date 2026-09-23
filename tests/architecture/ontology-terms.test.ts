/**
 * @vitest-environment node
 *
 * Every `thought:` / `minerva:` term the code names is declared in an
 * ontology file (#2230, epic #2241).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `src/shared/ontology.ttl` and `src/shared/ontology-thought.ttl` are
 * load-bearing in two very different ways, and until this test only one of
 * them was real:
 *
 *   - **As LLM prompt text** they are authoritative — `describe_graph_schema`
 *     hands both files to the model verbatim and tells it "the returned text
 *     is authoritative" before it writes SPARQL. A predicate the code writes
 *     but the ontology omits is a predicate the model will never query; a
 *     predicate the ontology names but nothing writes is one the model will
 *     query and get nothing back from.
 *   - **As a contract** they were decorative. Nothing read a class or
 *     predicate name out of the Turtle to check it against the code, so the
 *     two could drift indefinitely — and had. The architecture review found
 *     `health-checks.ts` querying `?claim a thought:Claim` for claims that
 *     have asserted `a types:Claim` since #2036, which is a silent wrong
 *     answer ("no unsupported claims") from the feature whose entire job is
 *     finding gaps in reasoning.
 *
 * This test makes the second one real, cheaply. It is deliberately NOT a
 * SHACL/reasoner layer (see #2241's scope notes — that costs a quarter and
 * catches the same drift a day of test costs): it parses the Turtle, collects
 * every term the two files declare, scans `src/` for every term the code
 * *names*, and fails on the difference.
 *
 * ── What it catches ─────────────────────────────────────────────────────────
 *   - a `THOUGHT('newPredicate')` / `thought:newPredicate` added to the code
 *     without a matching declaration (the drift direction that made #2230);
 *   - a typo'd or imagined term anywhere in `src/`, prose included — the first
 *     run of this test found `thought:hasClaim`, a predicate that has never
 *     existed, being described to the LLM by `describe_graph_schema`'s own
 *     tool description, and `thought:hasTag`, which the annotated-reading
 *     exporter parsed out of excerpt Turtle that only ever carries
 *     `minerva:hasTag`;
 *   - a Turtle syntax error in either file, since a parse failure fails the
 *     test. That alone was worth the price of admission: `ontology.ttl` had
 *     carried a stray `;x` on `minerva:hasTag` for long enough that nobody
 *     could say when it landed, which made the whole file unparseable — and
 *     it was still being shipped to the model as "authoritative".
 *
 * ── What it does NOT catch ──────────────────────────────────────────────────
 *   - the reverse direction: a term declared in the ontology that nothing
 *     writes or reads. That's a real (and larger) question — the thought
 *     ontology declares 30+ epistemic-defect classes no code path produces —
 *     but "declared and unused" is how an ontology is *supposed* to work for
 *     vocabulary the user authors by hand, so it can't be a failing assertion
 *     without a way to tell those apart;
 *   - whether a declared term's `rdfs:domain`/`rdfs:range` match how the code
 *     actually uses it. Only the name is checked;
 *   - terms assembled at runtime from a variable (`THOUGHT(lt.predicate)` in
 *     `state.ts`, `THOUGHT(mapped.local)` in `indexers/frontmatter.ts`). Both
 *     of those read from static tables — `LINK_TYPES` and
 *     `frontmatter-predicates.ts`'s `MAP` — whose entries are literal
 *     `THOUGHT('…')` calls or literal `predicate:` strings this scanner does
 *     see, so the coverage gap is narrower than the dynamic call sites make
 *     it look. It is not zero.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Parser } from 'n3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The two ontology files, and the namespaces they are authoritative for. */
const ONTOLOGY_FILES = [
  'src/shared/ontology.ttl',
  'src/shared/ontology-thought.ttl',
] as const;

const NAMESPACES: Record<string, string> = {
  minerva: 'https://minerva.dev/ontology#',
  thought: 'https://minerva.dev/ontology/thought#',
};

/**
 * Names in these namespaces that are deliberately NOT ontology terms.
 *
 * Every entry needs a reason. This is not a backlog list to be worked down
 * (that's what declaring the term is for) — it's for the handful of places
 * where `prefix:something` is a string that happens to look like a CURIE.
 */
const NOT_A_TERM: Record<string, string> = {
  'minerva:bibliography':
    'The `<!-- minerva:bibliography -->` HTML marker delimiting a generated ' +
    'bibliography block in a note body — a comment token, not a predicate.',
};

/**
 * `minerva:meta-<key>` is the documented fallthrough for any frontmatter key
 * with no canonical mapping (`frontmatter-predicates.ts`). The local names are
 * open-ended by construction — whatever the user typed — so they can't be
 * enumerated in the ontology, and the examples that appear in code comments
 * (`minerva:meta-author`, `minerva:meta-city`) are illustrations of the rule
 * rather than terms in their own right.
 */
const DYNAMIC_LOCAL_NAME = /^meta-/;

/**
 * A prefixed name in `src/`. The lookbehind is what keeps `urn:minerva:asset:…`
 * and `.minerva/graph.ttl`-style paths out: a real CURIE never has an
 * identifier character, another colon, a `#`, `/` or `-` immediately before
 * its prefix.
 */
const CURIE = /(?<![A-Za-z0-9_:#/-])(minerva|thought):([A-Za-z_][A-Za-z0-9_-]*)/g;

/** `THOUGHT('x')` / `MINERVA('x')` with a literal argument. */
const NS_HELPER_CALL = /\b(THOUGHT|MINERVA)\(\s*'([^']*)'\s*\)/g;

/** Every term (`prefix:local`) the two ontology files declare as a subject. */
function declaredTerms(): Set<string> {
  const declared = new Set<string>();
  for (const relative of ONTOLOGY_FILES) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf-8');
    // Throws on a syntax error, which fails the test — see the header.
    const quads = new Parser().parse(text);
    for (const quad of quads) {
      if (quad.subject.termType !== 'NamedNode') continue;
      const term = toCurie(quad.subject.value);
      if (term) declared.add(term);
    }
  }
  return declared;
}


/**
 * Terms whose declaration contradicts itself — the same subject given more
 * than one `rdfs:range`, `rdfs:domain`, `rdfs:label` or `rdfs:comment`
 * (#2345).
 *
 * `declaredTerms()` above collects subjects into a Set, so a term declared
 * TWICE is indistinguishable there from one declared once — which is how
 * `thought:archivedAt` came to be declared in two places with contradictory
 * meanings (a source's archival-copy PATH, `xsd:string`, domain
 * `thought:Source`; and a conversation's archived TIMESTAMP, `xsd:dateTime`,
 * domain `thought:Conversation`) and nothing noticed.
 *
 * Deliberately NOT "this subject has two rdf:type quads": multi-typing is
 * legal and used here (an individual can be both a class member and an
 * `owl:NamedIndividual`). What is never right is one property carrying two
 * ranges — a consumer cannot honour both — or one term carrying two labels or
 * two comments, which means two authors described two different things under
 * one name.
 *
 * Why this matters more than tidiness: `describe_graph_schema` hands these
 * files to the LLM verbatim and tells it the contents are authoritative
 * before it writes SPARQL. A model reading two contradictory declarations of
 * one predicate will use whichever it saw last, and the resulting query looks
 * entirely plausible.
 */
const UNIQUE_PER_TERM = ['range', 'domain', 'label', 'comment'] as const;

function contradictoryTerms(): string[] {
  const problems: string[] = [];
  for (const relative of ONTOLOGY_FILES) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf-8');
    const quads = new Parser().parse(text);
    for (const key of UNIQUE_PER_TERM) {
      const iri = `http://www.w3.org/2000/01/rdf-schema#${key}`;
      const values = new Map<string, Set<string>>();
      for (const quad of quads) {
        if (quad.predicate.value !== iri) continue;
        const term = toCurie(quad.subject.value);
        if (!term) continue;
        const seen = values.get(term) ?? new Set<string>();
        seen.add(quad.object.value);
        values.set(term, seen);
      }
      for (const [term, seen] of values) {
        if (seen.size > 1) {
          problems.push(`${relative}: ${term} has ${seen.size} distinct rdfs:${key} values `
            + `(${[...seen].join(' | ')})`);
        }
      }
    }
  }
  return problems.sort();
}

/** `https://minerva.dev/ontology#hasTag` → `minerva:hasTag`; null off-namespace. */
function toCurie(iri: string): string | null {
  for (const [prefix, base] of Object.entries(NAMESPACES)) {
    if (iri.startsWith(base) && iri.length > base.length) {
      return `${prefix}:${iri.slice(base.length)}`;
    }
  }
  return null;
}

/**
 * Tracked files under `src/`, minus the ontology files themselves. Everything
 * else is in scope — `.ts`, `.svelte`, and the stock skill/type `.md` files,
 * whose prompt bodies name `thought:` predicates for the LLM to write and are
 * exactly as capable of naming one that doesn't exist.
 */
function sourceFiles(): string[] {
  const tracked = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf-8' });
  return tracked
    .split('\n')
    .filter(Boolean)
    .filter((relative) => !(ONTOLOGY_FILES as readonly string[]).includes(relative));
}

/** term → the files naming it, for every term `src/` mentions. */
function referencedTerms(): Map<string, string[]> {
  const referenced = new Map<string, string[]>();
  const note = (term: string, file: string): void => {
    const files = referenced.get(term);
    if (files) { if (!files.includes(file)) files.push(file); }
    else referenced.set(term, [file]);
  };

  for (const relative of sourceFiles()) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf-8');
    for (const m of text.matchAll(CURIE)) note(`${m[1]}:${m[2]}`, relative);
    for (const m of text.matchAll(NS_HELPER_CALL)) {
      // `THOUGHT('')` is the namespace base itself (used for IRI prefix tests),
      // not a term.
      if (m[2]) note(`${m[1]!.toLowerCase()}:${m[2]}`, relative);
    }
  }
  return referenced;
}

function undeclaredTerms(): Array<{ term: string; files: string[] }> {
  const declared = declaredTerms();
  const out: Array<{ term: string; files: string[] }> = [];
  for (const [term, files] of [...referencedTerms()].sort(([a], [b]) => a.localeCompare(b))) {
    if (declared.has(term)) continue;
    if (term in NOT_A_TERM) continue;
    if (DYNAMIC_LOCAL_NAME.test(term.split(':')[1]!)) continue;
    out.push({ term, files });
  }
  return out;
}

describe('no term is declared twice with contradictory meanings (#2345)', () => {
  it('every term has at most one range, domain, label and comment', () => {
    expect(
      contradictoryTerms(),
      'A term declared in two places with different meanings is handed to the LLM '
        + 'as authoritative by `describe_graph_schema`. Rename one of them (#2345).',
    ).toEqual([]);
  });

  it('the check can see the properties it is checking — an empty scan would pass vacuously', () => {
    // If `toCurie` or the rdfs IRIs ever stop matching, `contradictoryTerms()`
    // returns [] for the same reason a clean file does.
    // Both files: `ontology.ttl` alone carries 31 ranges, so anchoring on the
    // first entry made this fail against a perfectly healthy tree. The guard
    // is about the scan working at all, not about either file's size.
    const ranges = ONTOLOGY_FILES.flatMap((relative) =>
      new Parser()
        .parse(fs.readFileSync(path.join(ROOT, relative), 'utf-8'))
        .filter((q) => q.predicate.value === 'http://www.w3.org/2000/01/rdf-schema#range'
          && toCurie(q.subject.value) !== null));
    expect(ranges.length).toBeGreaterThan(100);
  });
});

describe('ontology terms are executable, not decorative (#2230)', () => {
  it('parses both ontology files as valid Turtle', () => {
    // Explicit, so a syntax error reports as "the ontology does not parse"
    // rather than as a mystery inside the coverage assertion below.
    expect(() => declaredTerms()).not.toThrow();
  });

  it('declares something in each namespace', () => {
    // Guards the scanner itself: a broken prefix constant or a parser change
    // that returned zero quads would make the real assertion below pass
    // vacuously (nothing declared, but also nothing compared against).
    const declared = [...declaredTerms()];
    expect(declared.filter((t) => t.startsWith('minerva:')).length).toBeGreaterThan(20);
    expect(declared.filter((t) => t.startsWith('thought:')).length).toBeGreaterThan(100);
  });

  it('finds terms to check in src/', () => {
    // Same guard from the other side — a `git ls-files` or regex regression
    // that found no references would also pass vacuously.
    expect(referencedTerms().size).toBeGreaterThan(100);
  });

  it('every thought:/minerva: term named in src/ is declared in an ontology file', () => {
    const undeclared = undeclaredTerms();
    const report = undeclared
      .map(({ term, files }) => `  ${term}\n      ${files.join('\n      ')}`)
      .join('\n');
    expect(
      undeclared,
      undeclared.length === 0 ? '' :
        `${undeclared.length} term(s) named in src/ are not declared in ` +
        `src/shared/ontology.ttl or src/shared/ontology-thought.ttl:\n${report}\n\n` +
        'Declare the term in the matching ontology file, fix the typo, or — if ' +
        'it is a string that only looks like a CURIE — add it to NOT_A_TERM in ' +
        'this file with a reason.',
    ).toEqual([]);
  });
});
