/**
 * Type subclassing substrate (#1586): a type's `parent` materializes as an
 * `rdfs:subClassOf` edge, and a subclass's instance is returned when querying
 * for the parent class via a property path — the read side the Objects browser
 * and multi-view build on (#1587).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

let root: string;
let ctx: ProjectContext;

function writeType(id: string, frontmatter: string): void {
  const dir = path.join(root, '.minerva', 'types');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.md`), `---\n${frontmatter}\n---\n`, 'utf-8');
}
function writeNote(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}
async function paths(sparql: string): Promise<string[]> {
  const { results } = await queryGraph(ctx, sparql);
  return (results as Array<{ p: string }>).map((r) => r.p).sort();
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-subclassof-'));
  ctx = projectContext(root);
  await initGraph(ctx);
  writeType('reference', `label: Reference`);
  writeType('monograph', `label: Monograph
parent: reference`);
  writeNote('Dune.md', `---
title: Dune
type: monograph
---
`);      // a Book (⊂ Reference)
  writeNote('Cite.md', `---\ntitle: Cite\ntype: reference\n---\n`); // a direct Reference
  await indexAllNotes(ctx);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('subclassing (#1586)', () => {
  it('materializes types:Monograph rdfs:subClassOf types:Reference', async () => {
    const { results } = await queryGraph(ctx, `SELECT ?x WHERE { types:Monograph rdfs:subClassOf types:Reference . BIND("ok" AS ?x) }`);
    expect(results).toHaveLength(1);
  });

  it('returns a subclass instance when querying the parent via the property path', async () => {
    // The parent's instances = direct Reference notes + subclass (Book) notes.
    expect(await paths(
      `SELECT ?p WHERE { ?n minerva:relativePath ?p ; rdf:type/rdfs:subClassOf* types:Reference }`,
    )).toEqual(['Cite.md', 'Dune.md']);
  });

  it('a DIRECT type query excludes the subclass (only the path includes it)', async () => {
    // Dune is typed Book, not directly Reference.
    expect(await paths(`SELECT ?p WHERE { ?n minerva:relativePath ?p ; a types:Reference }`)).toEqual(['Cite.md']);
    expect(await paths(`SELECT ?p WHERE { ?n minerva:relativePath ?p ; a types:Monograph }`)).toEqual(['Dune.md']);
  });
});
