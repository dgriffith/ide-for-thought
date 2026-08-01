/**
 * Typed objects — frontmatter `type:` → graph class edge (#1062).
 *
 * A note with `type: book` becomes an instance of the registered `types:Book`
 * class (a Note + an extra rdf:type), and the stock classes materialize so the
 * graph — not just the registry — knows they exist. Unknown types stay plain
 * notes (no enforcement).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

let root: string;
let ctx: ProjectContext;

function writeNote(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-typed-obj-'));
  ctx = projectContext(root);
  await initGraph(ctx);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('typed objects: frontmatter type → graph (#1062)', () => {
  it('a `type: book` note is an instance of types:Book (queryable by class)', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\nauthor: Frank Herbert\n---\n# Dune\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `SELECT ?title WHERE { ?n a types:Book ; dc:title ?title }`);
    expect((results as Array<{ title: string }>).map((r) => r.title)).toContain('Dune');
  });

  it('the note keeps its minerva:Note type too (it is a Note + extra type)', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\n---\n`);
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `SELECT ?t WHERE { ?n dc:title "Dune" ; a ?t }`);
    const types = (results as Array<{ t: string }>).map((r) => r.t);
    expect(types.some((t) => t.endsWith('ontology#Note'))).toBe(true);
    expect(types.some((t) => t.endsWith('types#Book'))).toBe(true);
  });

  it('materializes the stock classes as rdfs:Class with a typeId', async () => {
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `SELECT ?id WHERE { ?c a rdfs:Class ; minerva:typeId ?id } ORDER BY ?id`);
    const ids = (results as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain('book');
    expect(ids).toContain('person');
  });

  it('an unknown type id does not create a class edge (no enforcement)', async () => {
    writeNote('Thing.md', `---\ntitle: Thing\ntype: nonexistent-type\n---\n`);
    await indexAllNotes(ctx);
    // Still a note; no types:* class edge beyond minerva:Note.
    const { results } = await queryGraph(ctx, `
      SELECT ?t WHERE {
        ?n dc:title "Thing" ; a ?t .
        FILTER(STRSTARTS(STR(?t), "https://minerva.dev/ontology/types#"))
      }`);
    expect(results).toHaveLength(0);
  });

  it('does not also emit `type` as an opaque minerva:meta-type literal', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\n---\n`);
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `SELECT ?v WHERE { ?n dc:title "Dune" ; minerva:meta-type ?v }`);
    expect(results).toHaveLength(0);
  });
});
