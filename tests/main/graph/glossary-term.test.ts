/**
 * Glossary terms (#1142). Generate Glossary / Add Term to Glossary file term
 * notes with a fixed frontmatter schema plus a `this: a thought:Term .` turtle
 * block. This pins the round-trip: the note types as thought:Term and its
 * term / disambiguation / see-also frontmatter materialises as thought:*
 * predicates the graph can query. If the mapping or the ontology drifts, a
 * glossary silently stops being graph-legible.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { getAliasMap } from '../../../src/main/graph/queries';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const monoid = ['---', 'title: Monoid', 'term: Monoid', '---', '', '# Monoid', '', 'A semigroup with an identity element.', '', '```turtle', 'this: a thought:Term .', '```', ''].join('\n');

const semigroup = [
  '---',
  'title: Semigroup',
  'term: Semigroup',
  'aliases: [semigroups]',
  'disambiguation: "Not to be confused with a Monoid, which adds an identity."',
  'see-also: ["[[Monoid]]"]',
  '---',
  '',
  '# Semigroup',
  '',
  'A set with an associative binary operation.',
  '',
  '```turtle',
  'this: a thought:Term .',
  '```',
  '',
].join('\n');

describe('glossary term notes materialise thought:Term + predicates (#1142)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-glossary-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    await indexNote(ctx, 'glossary/Monoid.md', monoid);
    await indexNote(ctx, 'glossary/Semigroup.md', semigroup);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('types both notes as thought:Term', async () => {
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      PREFIX minerva: <https://minerva.dev/ontology#>
      SELECT ?path WHERE { ?t a thought:Term ; minerva:relativePath ?path } ORDER BY ?path
    `);
    const rows = r.results as Array<{ path: string }>;
    expect(rows.map((x) => x.path)).toEqual(['glossary/Monoid.md', 'glossary/Semigroup.md']);
  });

  it('materialises thought:term and thought:disambiguation literals', async () => {
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?term ?dis WHERE {
        ?s thought:term ?term ; thought:disambiguation ?dis .
      }
    `);
    const rows = r.results as Array<{ term: string; dis: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].term).toBe('Semigroup');
    expect(rows[0].dis).toMatch(/Monoid/);
  });

  it('materialises a thought:seeAlso edge to the sibling term note', async () => {
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?target WHERE { ?s thought:seeAlso ?target }
    `);
    const rows = r.results as Array<{ target: string }>;
    expect(rows.length).toBe(1);
    // Resolves to the REAL term note in glossary/ (basename resolution now
    // matches navigation, #1142) — not a phantom root `Monoid` and not a
    // literal "[[Monoid]]" string.
    expect(rows[0].target).toMatch(/note\/glossary\/Monoid$/);
    expect(rows[0].target).not.toContain('[[');
  });

  it('registers frontmatter aliases so [[semigroups]] resolves to the term note', () => {
    expect(getAliasMap(ctx)['semigroups']).toBe('glossary/Semigroup.md');
  });
});
