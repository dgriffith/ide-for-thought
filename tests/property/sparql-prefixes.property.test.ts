/**
 * @vitest-environment node
 *
 * Property tests for `injectSparqlPrefixes` (#2388).
 *
 * Queries come from a small grammar: a prologue of user PREFIX / BASE
 * declarations (keyword in any case, varied whitespace, comments between,
 * standard names, case-variants of standard names like `DC`, custom names,
 * the empty prefix), then a SELECT / ASK whose body uses some mix of
 * declared and standard prefixed names — with decoys that MENTION a prefix
 * declaration without making one: a `# PREFIX dc: …` comment, a string
 * literal, an IRI containing `#prefix`.
 *
 *   1. Idempotent: inject(inject(q)) === inject(q).
 *   2. Never duplicates a declaration: each prefix name is declared at most
 *      once in the result, whatever case the user's keyword was in.
 *   3. Never overrides the user: every name the user declared keeps the
 *      user's IRI, and is not injected.
 *   4. Parses wherever the input parsed.
 *   5. The contract the injector exists for: every prefix the body uses
 *      RESOLVES to the user's IRI when the user declared that exact name, and
 *      to Minerva's standard IRI otherwise.
 *
 * "Parses" means the app's own SPARQL engine (Comunica, via `getEngine`)
 * accepts it against an empty store.
 *
 * Counterexample convention: see `untrusted-content.property.test.ts`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { Store } from 'n3';
import { injectSparqlPrefixes } from '../../src/main/graph/index';
import { getEngine, STANDARD_PREFIXES } from '../../src/main/graph/state';
import { propertyParams } from '../helpers/property';

const STANDARD = STANDARD_PREFIXES.map(([p]) => p);

type Engine = Awaited<ReturnType<typeof getEngine>>;
let engine: Engine;
const empty = new Store();

beforeAll(async () => {
  engine = await getEngine();
});

/** Run `q` against an empty store: its single row as `{ var: IRI }`, or
 *  `null` when the engine rejects it (a parse or unknown-prefix error). */
async function run(q: string): Promise<Record<string, string> | null> {
  try {
    const result = await engine.query(q, { sources: [empty] });
    if (result.resultType !== 'bindings') return {};
    const rows = await (await result.execute()).toArray();
    return Object.fromEntries([...(rows[0] ?? [])].map(([k, v]) => [k.value, v.value]));
  } catch {
    return null;
  }
}

/** Prefix declarations in `q`'s prologue, in order: [name, iri]. */
function prologueDecls(q: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /\s*(?:#[^\n]*\n\s*)*(?:(prefix)\s+([A-Za-z][\w-]*)?:\s*<([^>]*)>|(base)\s+<[^>]*>)/iy;
  for (;;) {
    const m = re.exec(q);
    if (!m) return out;
    if (m[1]) out.push([m[2] ?? '', m[3]!]);
  }
}

// ── Grammar ────────────────────────────────────────────────────────────────
const keyword = fc.constantFrom('PREFIX', 'prefix', 'Prefix', 'pReFiX');
const ws = fc.constantFrom(' ', '  ', '\t', '\n', ' \n ');
const declName = fc.constantFrom(...STANDARD, 'DC', 'Rdf', 'FOAF', 'ex', 'ex2', '');
const iri = fc.constantFrom('http://example.com/a#', 'http://example.com/b/', 'urn:x:');
const comment = fc.constantFrom('', '', '# a comment\n', '# PREFIX dc: <http://example.com/fake#>\n', '#prefix foaf:\n');

const userDecl = fc
  .tuple(comment, keyword, ws, declName, iri, ws)
  .map(([c, k, w, n, i, w2]) => ({ name: n, text: `${c}${k}${w}${n}: <${i}>${w2}` }));
const baseDecl = fc.constantFrom('', '', 'BASE <http://example.com/base/>\n', 'base <urn:b:>\n');

const prologue = fc
  .tuple(baseDecl, fc.uniqueArray(userDecl, { selector: (d) => d.name, maxLength: 4 }))
  .map(([b, ds]) => ({ names: ds.map((d) => d.name), text: b + ds.map((d) => d.text).join('\n') + '\n' }));

/** Prefix names the body may use: `declared` come from the prologue. */
function usedPrefixes(declared: string[], allowUnbound: boolean) {
  const pool = [...new Set([...declared, ...STANDARD, ...(allowUnbound ? ['nope'] : [])])];
  return fc.array(fc.constantFrom(...pool), { minLength: 1, maxLength: 4 });
}

const decoy = fc.constantFrom(
  '',
  '\n  # PREFIX skos: <http://example.com/skos-in-a-comment#>\n',
  '  BIND("prefix owl: in a string" AS ?strN)\n',
  '  BIND(<http://example.com/x#prefix-foaf> AS ?iriN)\n',
  '  OPTIONAL { ?s <http://example.com/x#prefix> ?o }\n',
);

/** The body: each used prefix appears once in a triple pattern and once
 *  BOUND to a variable (`?v0`, `?v1`, …), so the result names the IRI it
 *  resolved to. */
function queryFor(declared: string[], allowUnbound: boolean) {
  return fc
    .tuple(usedPrefixes(declared, allowUnbound), decoy, decoy)
    .map(([used, a, b]) => {
      // Two decoys may be the same one; a variable can only be BOUND once.
      const d1 = a.replace(/\?(str|iri)N/, '?$1A');
      const d2 = b.replace(/\?(str|iri)N/, '?$1B');
      const patterns = used.map((p) => `  OPTIONAL { ?s ${p}:x ?o }`).join('\n');
      const binds = used.map((p, i) => `  BIND(${p}:x AS ?v${i})`).join('\n');
      return { used, body: `SELECT * WHERE {\n${d1}${patterns}\n${binds}\n${d2}}` };
    });
}

interface Generated {
  names: string[];
  userIri: Map<string, string>;
  used: string[];
  q: string;
}

function generated(allowUnbound: boolean): fc.Arbitrary<Generated> {
  return prologue.chain((p) =>
    queryFor(p.names, allowUnbound).map(({ used, body }) => {
      const q = p.text + body;
      return { names: p.names, userIri: new Map(prologueDecls(q)), used, q };
    }),
  );
}

/** A query whose body only uses declared-or-standard prefixes. */
const boundQuery = generated(false);
/** Anything goes, including a prefix nobody declares. */
const anyQuery = generated(true);

const STANDARD_IRI = new Map(STANDARD_PREFIXES);

// ── Properties ─────────────────────────────────────────────────────────────
describe('injectSparqlPrefixes properties (#2388)', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(anyQuery, ({ q }) => {
        const once = injectSparqlPrefixes(q);
        expect(injectSparqlPrefixes(once)).toBe(once);
      }),
      propertyParams(300),
    );
  });

  it('never declares a prefix name twice', () => {
    fc.assert(
      fc.property(anyQuery, ({ q }) => {
        const names = prologueDecls(injectSparqlPrefixes(q)).map(([n]) => n);
        expect(names.length).toBe(new Set(names).size);
      }),
      propertyParams(300),
    );
  });

  it("never overrides a user's declaration", () => {
    fc.assert(
      fc.property(anyQuery, ({ q, userIri }) => {
        const out = new Map(prologueDecls(injectSparqlPrefixes(q)));
        for (const [name, iriValue] of userIri) expect(out.get(name)).toBe(iriValue);
      }),
      propertyParams(300),
    );
  });

  it('parses wherever the input parsed', async () => {
    await fc.assert(
      fc.asyncProperty(anyQuery, async ({ q }) => {
        fc.pre((await run(q)) !== null);
        expect(await run(injectSparqlPrefixes(q)), injectSparqlPrefixes(q)).not.toBeNull();
      }),
      propertyParams(60),
    );
  });

  it("resolves every used prefix to the user's IRI, or else Minerva's standard one", async () => {
    // Stronger than "it parses": Comunica silently pre-binds a few common
    // prefixes (`dc`, `foaf`, `skos`, …) to ITS choice of namespace, so a
    // query whose injection was wrongly skipped still parses — and quietly
    // matches nothing. The bound IRI is what has to be right.
    await fc.assert(
      fc.asyncProperty(boundQuery, async ({ q, used, userIri }) => {
        const out = injectSparqlPrefixes(q);
        const row = await run(out);
        expect(row, out).not.toBeNull();
        used.forEach((p, i) => {
          const expected = (userIri.get(p) ?? STANDARD_IRI.get(p)) + 'x';
          expect(row![`v${i}`], `${p}: in\n${out}`).toBe(expected);
        });
      }),
      propertyParams(100),
    );
  });
});
