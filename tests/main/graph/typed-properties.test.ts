/**
 * Typed-object property model (#1063): schema-driven datatype coercion, the
 * frontmatter⇄graph round-trip, no-enforcement, and the read-back projection.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, indexNote, queryGraph, getNoteTypedProperties } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-typed-props-');
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

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

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

  it('a declared `boolean` becomes xsd:boolean — from YAML true or the word "false" (#2431)', async () => {
    writeNote('.minerva/types/chore.md', '---\nlabel: Chore\nid: chore\nproperties:\n  - name: done\n    type: boolean\n---\n');
    writeNote('A.md', `---\ntitle: A\ntype: chore\ndone: true\n---\n`);
    writeNote('B.md', `---\ntitle: B\ntype: chore\ndone: "false"\n---\n`);
    writeNote('C.md', `---\ntitle: C\ntype: chore\ndone: maybe\n---\n`);
    await indexAllNotes(ctx);
    expect(await datatypeOf('A', 'minerva:meta-done')).toMatch(/#boolean$/);
    expect(await datatypeOf('B', 'minerva:meta-done')).toMatch(/#boolean$/);
    expect(await datatypeOf('C', 'minerva:meta-done')).toMatch(/#string$/); // not coercible → plain
  });

  it('a declared `text` stays a plain string — not mis-inferred as a number/year', async () => {
    // isbn is declared text; a bare-year-looking value must NOT become xsd:gYear.
    writeNote('A.md', `---\ntitle: A\ntype: book\nisbn: 2020\n---\n`);
    await indexAllNotes(ctx);
    expect(await datatypeOf('A', 'bibo:isbn')).toMatch(/#string$/);
  });

  it('a `link-to-type` value materialises a labeled ROLE edge to the target (#1073)', async () => {
    writeNote('Alice.md', `---\ntitle: Alice\ntype: person\n---\n`);
    writeNote('Roadmap.md', `---\ntitle: Roadmap\ntype: project\nowner: "[[Alice]]"\n---\n`);
    await indexAllNotes(ctx);
    // The edge is under the property's ROLE predicate (types:owner), not a
    // generic dc:*/minerva:meta-* one — queryable by its role.
    const { results } = await queryGraph(
      ctx,
      `SELECT ?o WHERE { ?n dc:title "Roadmap" ; types:owner ?o }`,
    );
    const owner = (results as Array<{ o?: string }>)[0]?.o ?? '';
    expect(owner).toContain('/note/Alice'); // an object ref, not a literal
    // And NOT under the old generic predicate.
    const { results: old } = await queryGraph(ctx, `SELECT ?o WHERE { ?n dc:title "Roadmap" ; minerva:meta-owner ?o }`);
    expect(old).toHaveLength(0);
  });

  it('a note missing an expected property still indexes cleanly (no enforcement)', async () => {
    writeNote('A.md', `---\ntitle: A\ntype: book\n---\n# A\n`);
    await expect(indexAllNotes(ctx)).resolves.toBeGreaterThanOrEqual(1);
    const { results } = await queryGraph(ctx, `SELECT ?t WHERE { ?n dc:title "A" ; a types:Book . BIND("ok" AS ?t) }`);
    expect(results).toHaveLength(1);
  });
});

describe('typed properties: date and datetime literals (#2613)', () => {
  const TYPE = '---\nlabel: Happening\nid: happening\nproperties:\n  - name: when\n    type: datetime\n  - name: day\n    type: date\n---\n';
  const note = (title: string, fm: string) => writeNote(`${title}.md`, `---\ntitle: ${title}\ntype: happening\n${fm}\n---\n`);

  async function literalOf(title: string, key: string): Promise<{ v?: string; dt?: string }> {
    const { results } = await queryGraph(
      ctx,
      `SELECT ?v (DATATYPE(?v) AS ?dt) WHERE { ?n dc:title "${title}" ; minerva:meta-${key} ?v }`,
    );
    return (results as Array<{ v?: string; dt?: string }>)[0] ?? {};
  }

  it.each([
    ['when: 2026-10-05T14:30', 'when', '2026-10-05T14:30:00', 'dateTime'],
    ['when: 2026-10-05T14:30:15+02:00', 'when', '2026-10-05T14:30:15+02:00', 'dateTime'],
    ['when: 2026-10-05T14:30Z', 'when', '2026-10-05T14:30:00Z', 'dateTime'],
    ['when: 2026-10-05', 'when', '2026-10-05', 'date'],
    ['when: 2026-10', 'when', '2026-10', 'gYearMonth'],
    ['when: 1969', 'when', '1969', 'gYear'],
    ['when: -0043', 'when', '-0043', 'gYear'], // YAML reads -0043 as the number -43
    ['when: 44', 'when', '0044', 'gYear'],
    ['when: "-0043-03-15"', 'when', '-0043-03-15', 'date'],
    ['when: "+12026-01-01"', 'when', '12026-01-01', 'date'],
    ['day: -0043', 'day', '-0043', 'gYear'], // the four-digit-year gap closed for `date` too
    ['day: "-0043-03-15"', 'day', '-0043-03-15', 'date'],
    ['day: 2026-10-05T14:30', 'day', '2026-10-05T14:30:00', 'dateTime'],
  ])('%s → "%s"^^xsd:%s', async (fm, key, lexical, datatype) => {
    writeNote('.minerva/types/happening.md', TYPE);
    note('A', fm);
    await indexAllNotes(ctx);
    const lit = await literalOf('A', key);
    expect(lit.v).toBe(lexical);
    expect(lit.dt).toBe(`http://www.w3.org/2001/XMLSchema#${datatype}`);
  });

  it('a value that isn\'t a date stays a plain string', async () => {
    writeNote('.minerva/types/happening.md', TYPE);
    note('A', 'when: next tuesday');
    note('B', 'day: 1969-02-30');
    await indexAllNotes(ctx);
    expect((await literalOf('A', 'when')).dt).toMatch(/#string$/);
    expect((await literalOf('B', 'day')).dt).toMatch(/#string$/);
  });

  it('answers a SPARQL range query over datetime values, across offsets and a date-only value', async () => {
    writeNote('.minerva/types/happening.md', TYPE);
    note('Breakfast', 'when: 2026-10-05T08:00Z');
    note('Standup', 'when: 2026-10-05T11:30+02:00'); // 09:30Z
    note('Lunch', 'when: 2026-10-05T12:00Z');
    note('Dinner', 'when: 2026-10-05T14:30-05:00'); // 19:30Z
    note('Allday', 'when: 2026-10-06');
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `
      SELECT ?title WHERE {
        ?n a types:Happening ; dc:title ?title ; minerva:meta-when ?w .
        FILTER(DATATYPE(?w) = xsd:dateTime && ?w >= "2026-10-05T09:00:00Z"^^xsd:dateTime && ?w < "2026-10-05T20:00:00Z"^^xsd:dateTime)
      } ORDER BY ?w`);
    expect((results as Array<{ title: string }>).map((r) => r.title)).toEqual(['Standup', 'Lunch', 'Dinner']);

    const { results: days } = await queryGraph(ctx, `
      SELECT ?title WHERE {
        ?n a types:Happening ; dc:title ?title ; minerva:meta-when ?w .
        FILTER(DATATYPE(?w) = xsd:date && ?w > "2026-10-05"^^xsd:date)
      }`);
    expect((days as Array<{ title: string }>).map((r) => r.title)).toEqual(['Allday']);
  });

  it('a floating (offset-free) time compares in a range query once its seconds are written', async () => {
    writeNote('.minerva/types/happening.md', TYPE);
    note('Early', 'when: 2026-10-05T08:00');
    note('Late', 'when: 2026-10-05T18:45');
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `
      SELECT ?title WHERE { ?n dc:title ?title ; minerva:meta-when ?w . FILTER(?w > "2026-10-05T12:00:00"^^xsd:dateTime) }`);
    expect((results as Array<{ title: string }>).map((r) => r.title)).toEqual(['Late']);
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
