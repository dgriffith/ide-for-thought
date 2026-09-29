/**
 * Frontmatter keys named after `Object.prototype` members (#2461 follow-up).
 *
 * `extractFrontmatter` used to copy YAML's output into a `{}` with
 * `result[key] = …`, so a `__proto__:` key hit the prototype setter — dropped,
 * and an object value re-parented the record so its members read back as
 * inherited keys. Separately `mapFrontmatterKey` read a plain map by user key,
 * so `constructor:` resolved to `Object.prototype.constructor` and indexed under
 * an `undefined` predicate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import YAML from 'yaml';
import { parseMarkdown } from '../../../src/main/graph/parser';
import { mapFrontmatterKey } from '../../../src/main/graph/frontmatter-predicates';
import { resolveFrontmatterPredicate, declaredPropertyPredicate } from '../../../src/main/graph/indexers';
import { indexNote, queryGraph } from '../../../src/main/graph/index';
import type { ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const PROTO_NOTE = `---
title: Proto
__proto__:
  x: 1
constructor: foo
toString: bar
nested:
  __proto__: deep
  valueOf: v
---
# Proto
`;

const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype);

describe('the yaml library itself', () => {
  it('parses __proto__ as an own data property of an ordinary object', () => {
    // Pinned so a yaml upgrade that changes this is noticed: our fix does not
    // depend on it, but the "what does the library do" answer is recorded here.
    const raw = YAML.parse('__proto__: {x: 1}\nconstructor: foo\n') as Record<string, unknown>;
    expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(raw, '__proto__')?.value).toEqual({ x: 1 });
    expect((raw as { x?: unknown }).x).toBeUndefined();
  });
});

describe('parseMarkdown frontmatter — Object.prototype key names', () => {
  it('keeps __proto__, constructor and toString as own keys', () => {
    const fm = parseMarkdown(PROTO_NOTE).frontmatter;
    expect(Object.keys(fm)).toEqual(['title', '__proto__', 'constructor', 'toString', 'nested']);
    expect(Object.hasOwn(fm, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(fm, '__proto__')?.value).toEqual({ x: 1 });
    expect(fm.constructor).toBe('foo');
    expect(fm.toString).toBe('bar');
  });

  it('is not re-parented by an object-valued __proto__', () => {
    const fm = parseMarkdown(PROTO_NOTE).frontmatter;
    expect(Object.getPrototypeOf(fm)).toBeNull();
    expect((fm as Record<string, unknown>).x).toBeUndefined();
    expect('x' in fm).toBe(false);
  });

  it('keeps Object.prototype names inside nested maps too', () => {
    const nested = parseMarkdown(PROTO_NOTE).frontmatter.nested as Record<string, unknown>;
    expect(Object.keys(nested)).toEqual(['__proto__', 'valueOf']);
    expect(Object.getOwnPropertyDescriptor(nested, '__proto__')?.value).toBe('deep');
    expect(nested.valueOf).toBe('v');
  });

  it('reads an absent Object.prototype name as undefined', () => {
    for (const content of ['---\ntitle: Plain\n---\n', 'no frontmatter', '---\n[1, 2]\n---\n', '---\n: : :\n---\n']) {
      const fm = parseMarkdown(content).frontmatter;
      for (const name of PROTO_NAMES) {
        expect(fm[name], `${name} in ${JSON.stringify(content)}`).toBeUndefined();
      }
    }
  });

  it('keeps __proto__ an own key through structured clone (the IPC shape)', () => {
    const wire = structuredClone(parseMarkdown(PROTO_NOTE).frontmatter);
    expect(Object.hasOwn(wire, '__proto__')).toBe(true);
    expect(Object.keys(wire)).toContain('__proto__');
  });
});

describe('frontmatter key → predicate', () => {
  it('does not map an Object.prototype name to a canonical predicate', () => {
    for (const name of PROTO_NAMES) {
      expect(mapFrontmatterKey(name), name).toBeNull();
      expect(resolveFrontmatterPredicate(name)?.value, name)
        .toBe(`https://minerva.dev/ontology#meta-${name}`);
      // The typed-property read-back resolves through the same function.
      expect(declaredPropertyPredicate(name, { type: 'text' }).value, name)
        .toBe(`https://minerva.dev/ontology#meta-${name}`);
    }
    // A real mapping still works.
    expect(mapFrontmatterKey('author')).toEqual({ ns: 'dc', local: 'creator' });
  });
});

describe('graph indexing of Object.prototype-named keys', () => {
  const project = useGraphProject('minerva-fm-proto-');
  let ctx: ProjectContext;
  beforeEach(() => { ctx = project.ctx; });

  it('emits minerva:meta-* triples for each, and nothing inherited', async () => {
    await indexNote(ctx, 'proto.md', PROTO_NOTE);
    const { results } = await queryGraph(ctx, `
      SELECT ?p ?o WHERE { ?n minerva:relativePath "proto.md" ; ?p ?o }
    `);
    const rows = results as Array<{ p: string; o: string }>;
    const byPred = new Map(rows.map((r) => [r.p.replace('https://minerva.dev/ontology#', 'minerva:'), r.o]));
    expect(byPred.get('minerva:meta-constructor')).toBe('foo');
    expect(byPred.get('minerva:meta-toString')).toBe('bar');
    expect(byPred.has('minerva:meta-__proto__')).toBe(true);
    // The __proto__ map's own key, on its blank node — not on the note.
    expect(byPred.has('minerva:meta-x')).toBe(false);
    const { results: inner } = await queryGraph(ctx, `
      SELECT ?x WHERE { ?n minerva:relativePath "proto.md" ; minerva:meta-__proto__ ?b . ?b minerva:meta-x ?x }
    `);
    expect((inner as Array<{ x: string }>).map((r) => r.x)).toEqual(['1']);
    // No predicate is undefined / a stringified function.
    for (const r of rows) expect(r.p).not.toMatch(/undefined|function|native code/);
  });
});
