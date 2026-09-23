/**
 * @vitest-environment node
 *
 * `docs/authoring-types.md` matches the type format it documents (#2265,
 * epic #2268).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The `.md`-with-frontmatter object-type format had no documentation outside
 * its parser. `externalClass:` — the #2036 key that bridges a user type to an
 * external vocabulary, and the single line that makes `type: claim` answer a
 * query about `thought:Claim` — appeared in **zero** files under `docs/` or
 * `website/docs/`. #2265 wrote the reference.
 *
 * A format reference is a hand-maintained inventory, and the epic's whole
 * thesis is that prose describing behaviour drifts the moment nothing checks
 * it. `config-roots-doc.test.ts` is the shape being copied: derive the facts
 * from the code, assert the doc names each one.
 *
 * Five inventories, each read from its own authority:
 *
 *   1. every frontmatter key `types/parse.ts` reads off the YAML mapping;
 *   2. every per-property key it reads off a `properties:` entry;
 *   3. every member of `PROPERTY_TYPES` (`shared/objects/type-def.ts`);
 *   4. every prefix in `STANDARD_PREFIXES` (`graph/state.ts`) — the closed set
 *      an `externalClass:` / `predicate:` CURIE can resolve against, and the
 *      one place a type author cannot discover by experiment, because an
 *      unrecognized prefix fails *silently*;
 *   5. every stock type file — the worked examples the doc points at, and a
 *      count the report found drifting in four other places.
 *
 * ── Scope, honestly ─────────────────────────────────────────────────────────
 * This checks PRESENCE, not accuracy: a key whose description has gone wrong
 * still passes. Naming the key is the part that actually gets forgotten — and
 * the alternative, asserting prose against behaviour, is what the test suite
 * proper is for.
 *
 * It also can't see a frontmatter key read somewhere other than `parse.ts`.
 * That is the right bet today (the parser is the single entry point, and
 * `write.ts` serializes back through the same field set), and it is the
 * assumption to re-check if type parsing ever grows a second reader.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const DOC = 'docs/authoring-types.md';
const PARSE = 'src/main/types/parse.ts';
const TYPE_DEF = 'src/shared/objects/type-def.ts';
const STATE = 'src/main/graph/state.ts';
const STOCK_DIR = 'src/main/types/stock';

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf-8');
}

/** Drop comments so a doc-comment mention never counts as a real field read. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Top-level frontmatter keys: `fm.<key>` in the parser. */
function frontmatterKeys(): string[] {
  const src = stripComments(read(PARSE));
  return [...new Set([...src.matchAll(/\bfm\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!))].sort();
}

/** Per-property keys: `obj.<key>` — the normalized `properties:` entry. */
function propertyKeys(): string[] {
  const src = stripComments(read(PARSE));
  return [...new Set([...src.matchAll(/\bobj\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!))].sort();
}

/** `export const PROPERTY_TYPES = ['text', …] as const;` */
function propertyTypes(): string[] {
  const m = read(TYPE_DEF).match(/PROPERTY_TYPES\s*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error(`could not find PROPERTY_TYPES in ${TYPE_DEF}`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

/** `export const STANDARD_PREFIXES: [string, string][] = [ ['minerva', '…'], …]` */
function standardPrefixes(): Array<{ prefix: string; iri: string }> {
  const src = read(STATE);
  const start = src.indexOf('STANDARD_PREFIXES');
  if (start < 0) throw new Error(`could not find STANDARD_PREFIXES in ${STATE}`);
  const block = src.slice(start, src.indexOf('];', start));
  return [...block.matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)]
    .map((m) => ({ prefix: m[1]!, iri: m[2]! }));
}

function stockTypeFiles(): string[] {
  return fs.readdirSync(path.join(ROOT, STOCK_DIR)).filter((f) => f.endsWith('.md')).sort();
}

/** Bounded mention, so `card` isn't satisfied by the word "discard". */
function mentions(doc: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(doc);
}

function missing(tokens: readonly string[]): string[] {
  const doc = read(DOC);
  return tokens.filter((t) => !mentions(doc, t));
}

describe('docs/authoring-types.md is checked against the code (#2265)', () => {
  it('the document exists', () => {
    expect(fs.existsSync(path.join(ROOT, DOC))).toBe(true);
  });

  it('each inventory is non-empty', () => {
    // Guards the extractors: a renamed const or a refactor that broke a regex
    // would otherwise make every assertion below pass against an empty list.
    expect(frontmatterKeys().length).toBeGreaterThan(8);
    expect(propertyKeys().length).toBeGreaterThan(4);
    expect(propertyTypes().length).toBeGreaterThan(4);
    expect(standardPrefixes().length).toBeGreaterThan(10);
    expect(stockTypeFiles().length).toBeGreaterThan(5);
  });

  it('documents every frontmatter key the parser reads', () => {
    const gaps = missing(frontmatterKeys());
    expect(
      gaps,
      gaps.length === 0 ? '' :
        `${PARSE} reads frontmatter key(s) that ${DOC} never names: ` +
        `${gaps.join(', ')}. Add them to the frontmatter reference (or, if one ` +
        'is deliberately undocumented, say so there — a key a hand-author ' +
        'cannot discover is a key that only exists for the dialog).',
    ).toEqual([]);
  });

  it('documents every per-property key the parser reads', () => {
    const gaps = missing(propertyKeys());
    expect(
      gaps,
      gaps.length === 0 ? '' :
        `${PARSE} reads property key(s) that ${DOC} never names: ${gaps.join(', ')}.`,
    ).toEqual([]);
  });

  it('documents every property type', () => {
    const gaps = missing(propertyTypes());
    expect(
      gaps,
      gaps.length === 0 ? '' :
        `PROPERTY_TYPES has value(s) ${DOC} never names: ${gaps.join(', ')}. ` +
        'A property type nobody documented is one nobody will use.',
    ).toEqual([]);
  });

  it('documents every prefix an externalClass/predicate CURIE can use', () => {
    const prefixes = standardPrefixes();
    const gapPrefixes = missing(prefixes.map((p) => p.prefix));
    const doc = read(DOC);
    const gapIris = prefixes.filter((p) => !doc.includes(p.iri)).map((p) => p.prefix);
    expect(
      { gapPrefixes, gapIris },
      gapPrefixes.length === 0 && gapIris.length === 0 ? '' :
        `${DOC}'s prefix table is out of step with STANDARD_PREFIXES in ` +
        `${STATE}.\n  missing prefix: ${gapPrefixes.join(', ') || '(none)'}` +
        `\n  missing/changed IRI: ${gapIris.join(', ') || '(none)'}\n\n` +
        'This one matters more than the others: an unrecognized prefix in a ' +
        'type definition is ignored silently, so the table is the only way a ' +
        'type author learns which vocabularies are reachable.',
    ).toEqual({ gapPrefixes: [], gapIris: [] });
  });

  it('lists every stock type', () => {
    const gaps = missing(stockTypeFiles());
    expect(
      gaps,
      gaps.length === 0 ? '' :
        `${STOCK_DIR} ships type(s) ${DOC}'s stock table omits: ${gaps.join(', ')}.`,
    ).toEqual([]);
  });
});
