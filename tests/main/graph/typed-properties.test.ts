/**
 * Typed-object property model (#1063): schema-driven datatype coercion, the
 * frontmatter⇄graph round-trip, no-enforcement, and the read-back projection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, indexNote, queryGraph, getNoteTypedProperties } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

let root: string;
let ctx: ProjectContext;

function writeNote(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

async function datatypeOf(title: string, predicate: string): Promise<string | undefined> {
  const { results } = await queryGraph(
    ctx,
    `SELECT (DATATYPE(?v) AS ?dt) WHERE { ?n dc:title "${title}" ; ${predicate} ?v }`,
  );
  return (results as Array<{ dt?: string }>)[0]?.dt;
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-typed-props-'));
  ctx = projectContext(root);
  await initGraph(ctx);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('typed properties: datatype coercion (#1063)', () => {
  it('a declared `number` becomes xsd:integer — even from a string', async () => {
    writeNote('A.md', `---\ntitle: A\ntype: book\nrating: 5\n---\n`);
    writeNote('B.md', `---\ntitle: B\ntype: book\nrating: "4"\n---\n`);
    await indexAllNotes(ctx);
    expect(await datatypeOf('A', 'minerva:meta-rating')).toMatch(/#integer$/);
    expect(await datatypeOf('B', 'minerva:meta-rating')).toMatch(/#integer$/); // coerced from string
  });

  it('a declared `date` becomes xsd:date', async () => {
    writeNote('A.md', `---\ntitle: A\ntype: book\npublished: 2020-06-01\n---\n`);
    await indexAllNotes(ctx);
    expect(await datatypeOf('A', 'minerva:meta-published')).toMatch(/#date$/);
  });

  it('a declared `text` stays a plain string — not mis-inferred as a number/year', async () => {
    // isbn is declared text; a bare-year-looking value must NOT become xsd:gYear.
    writeNote('A.md', `---\ntitle: A\ntype: book\nisbn: 2020\n---\n`);
    await indexAllNotes(ctx);
    expect(await datatypeOf('A', 'bibo:isbn')).toMatch(/#string$/);
  });

  it('a `link-to-type` value that is a wiki-link resolves to the target note', async () => {
    writeNote('Alice.md', `---\ntitle: Alice\ntype: person\n---\n`);
    writeNote('Roadmap.md', `---\ntitle: Roadmap\ntype: project\nowner: "[[Alice]]"\n---\n`);
    await indexAllNotes(ctx);
    const { results } = await queryGraph(
      ctx,
      `SELECT ?o WHERE { ?n dc:title "Roadmap" ; minerva:meta-owner ?o }`,
    );
    const owner = (results as Array<{ o?: string }>)[0]?.o ?? '';
    expect(owner).toContain('/note/Alice'); // an object ref, not a literal
  });

  it('a note missing an expected property still indexes cleanly (no enforcement)', async () => {
    writeNote('A.md', `---\ntitle: A\ntype: book\n---\n# A\n`);
    await expect(indexAllNotes(ctx)).resolves.toBeGreaterThanOrEqual(1);
    const { results } = await queryGraph(ctx, `SELECT ?t WHERE { ?n dc:title "A" ; a types:Book . BIND("ok" AS ?t) }`);
    expect(results).toHaveLength(1);
  });
});

describe('typed properties: read-back (#1063)', () => {
  it('returns every declared property, incl. declared-but-empty, with values', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\nauthor: Frank Herbert\nrating: 5\n---\n`);
    await indexAllNotes(ctx);

    const rb = await getNoteTypedProperties(ctx, 'Dune.md');
    expect(rb.type?.id).toBe('book');
    const byName = new Map(rb.properties.map((p) => [p.name, p]));
    // Book declares author, published, rating, status, isbn — all present.
    for (const name of ['author', 'published', 'rating', 'status', 'isbn']) {
      expect(byName.has(name)).toBe(true);
    }
    expect(byName.get('author')!.value).toBe('Frank Herbert');
    expect(byName.get('rating')!.value).toBe('5');
    expect(byName.get('published')!.value).toBeNull(); // declared but empty
    // Schema carried through for the form (enum options).
    expect(byName.get('status')!.type).toBe('enum');
    expect(byName.get('status')!.options).toContain('reading');
  });

  it('returns an empty projection for an untyped note', async () => {
    writeNote('Plain.md', `---\ntitle: Plain\n---\n`);
    await indexAllNotes(ctx);
    const rb = await getNoteTypedProperties(ctx, 'Plain.md');
    expect(rb.type).toBeNull();
    expect(rb.properties).toEqual([]);
  });
});

describe('typed properties: write→reindex round-trip (#1063)', () => {
  it('values survive a single-note reindex', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\nrating: 5\n---\n`);
    await indexAllNotes(ctx);
    // Re-index just this note (as write-pipeline does on save).
    await indexNote(ctx, 'Dune.md', fs.readFileSync(path.join(root, 'Dune.md'), 'utf-8'));
    expect(await datatypeOf('Dune', 'minerva:meta-rating')).toMatch(/#integer$/);
    const rb = await getNoteTypedProperties(ctx, 'Dune.md');
    expect(rb.properties.find((p) => p.name === 'rating')?.value).toBe('5');
  });
});
