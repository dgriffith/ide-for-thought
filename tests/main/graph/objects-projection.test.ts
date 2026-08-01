/**
 * The graph projection behind the Objects-by-type sidebar (#1068): the exact
 * SPARQL ObjectsPanel runs to count instances per type and list them.
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-objproj-'));
  ctx = projectContext(root);
  await initGraph(ctx);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('objects-by-type projection (#1068)', () => {
  it('counts instances per type', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\n---\n`);
    writeNote('Neuromancer.md', `---\ntitle: Neuromancer\ntype: book\n---\n`);
    writeNote('Ada.md', `---\ntitle: Ada\ntype: person\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(
      ctx,
      `SELECT ?id (COUNT(?x) AS ?n) WHERE { ?x a ?c . ?c minerva:typeId ?id } GROUP BY ?id`,
    );
    const counts = Object.fromEntries((results as Array<{ id: string; n: string }>).map((r) => [r.id, Number(r.n)]));
    expect(counts.book).toBe(2);
    expect(counts.person).toBe(1);
  });

  it('lists a type’s instances with path + title', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\n---\n`);
    writeNote('Neuromancer.md', `---\ntitle: Neuromancer\ntype: book\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(
      ctx,
      `SELECT ?path ?title WHERE { ?n a types:Book ; minerva:relativePath ?path . OPTIONAL { ?n dc:title ?title } } ORDER BY ?title`,
    );
    const rows = results as Array<{ path: string; title: string }>;
    expect(rows.map((r) => r.title)).toEqual(['Dune', 'Neuromancer']);
    expect(rows.map((r) => r.path)).toEqual(['Dune.md', 'Neuromancer.md']);
  });

  it('a zero-instance type simply has no rows (the panel shows it from the registry)', async () => {
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `SELECT ?path WHERE { ?n a types:Meeting ; minerva:relativePath ?path }`);
    expect(results).toHaveLength(0);
  });
});
