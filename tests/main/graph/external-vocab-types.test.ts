/**
 * Optional external classes/predicates for typed objects (#2036): a type may
 * declare `externalClass:` (an rdfs:subClassOf edge to a standard vocabulary
 * class, e.g. foaf:Person) and a property may declare `predicate:` (the
 * standard predicate its value materializes under, e.g. foaf:mbox), both
 * purely additive — absent means today's exact behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-external-vocab-');
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

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

describe('external class alignment (#2036)', () => {
  it('externalClass materializes as rdfs:subClassOf to the resolved external class', async () => {
    writeType('contact', `label: Contact\nexternalClass: foaf:Person\nproperties:\n  - name: name\n    type: text`);
    writeNote('Jane.md', `---\ntitle: Jane\ntype: contact\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?x WHERE { types:Contact rdfs:subClassOf foaf:Person . BIND("ok" AS ?x) }
    `);
    expect(results).toHaveLength(1);

    expect(await paths(
      `SELECT ?p WHERE { ?n minerva:relativePath ?p ; a/rdfs:subClassOf* foaf:Person }`,
    )).toEqual(['Jane.md']);
  });

  it('a type keeps its Minerva parent AND gains the external class — both subClassOf edges coexist', async () => {
    writeType('reference', `label: Reference\nproperties:\n  - name: citation\n    type: text`);
    writeType('article', `label: Article\nparent: reference\nexternalClass: bibo:Article\nproperties:\n  - name: citation\n    type: text`);
    writeNote('Paper.md', `---\ntitle: Paper\ntype: article\ncitation: Smith 2020\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?parent WHERE { types:Article rdfs:subClassOf ?parent }
    `);
    const parents = (results as Array<{ parent: string }>).map((r) => r.parent).sort();
    expect(parents).toEqual([
      'http://purl.org/ontology/bibo/Article',
      'https://minerva.dev/ontology/types#Reference',
    ]);
  });

  it('an unresolvable externalClass prefix is silently ignored, not an indexing failure', async () => {
    writeType('odd', `label: Odd\nexternalClass: notaprefix:Thing\nproperties:\n  - name: x\n    type: text`);
    writeNote('N.md', `---\ntitle: N\ntype: odd\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `SELECT ?p WHERE { types:Odd rdfs:subClassOf ?p }`);
    expect(results).toEqual([]);
    // The note itself still indexed fine.
    expect(await paths(`SELECT ?p WHERE { ?n minerva:relativePath ?p ; a types:Odd }`)).toEqual(['N.md']);
  });

  it('a type with no externalClass declared behaves exactly as before (no extra subClassOf)', async () => {
    writeType('plain', `label: Plain\nproperties:\n  - name: x\n    type: text`);
    writeNote('P.md', `---\ntitle: P\ntype: plain\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `SELECT ?p WHERE { types:Plain rdfs:subClassOf ?p }`);
    expect(results).toEqual([]);
  });
});

describe('per-property predicate mapping (#2036)', () => {
  it('a property with an explicit predicate: materializes under it instead of the default', async () => {
    writeType('contact', `label: Contact\nproperties:\n  - name: mail\n    type: text\n    predicate: foaf:mbox`);
    writeNote('Jane.md', `---\ntitle: Jane\ntype: contact\nmail: jane@example.com\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?v WHERE { ?n minerva:relativePath "Jane.md" ; foaf:mbox ?v . }
    `);
    expect((results as Array<{ v: string }>).map((r) => r.v)).toEqual(['jane@example.com']);

    // Nothing landed under the old default meta-* fallback.
    const fallback = await queryGraph(ctx, `
      SELECT ?v WHERE { ?n minerva:relativePath "Jane.md" ; minerva:meta-mail ?v . }
    `);
    expect(fallback.results).toEqual([]);
  });

  it('a property with no predicate: mapping keeps the default fallback (unchanged)', async () => {
    writeType('contact', `label: Contact\nproperties:\n  - name: mail\n    type: text`);
    writeNote('Jane.md', `---\ntitle: Jane\ntype: contact\nmail: jane@example.com\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?v WHERE { ?n minerva:relativePath "Jane.md" ; minerva:meta-mail ?v . }
    `);
    expect((results as Array<{ v: string }>).map((r) => r.v)).toEqual(['jane@example.com']);
  });
});

describe('stock Person type (#2036)', () => {
  it('emails a Person via foaf:mbox; role/organization keep their default predicates', async () => {
    writeNote('Jane Smith.md', `---\ntitle: Jane Smith\ntype: person\nrole: Engineer\norganization: Acme\nemail: jane@example.com\n---\n`);
    await indexAllNotes(ctx);

    const mbox = await queryGraph(ctx, `
      SELECT ?v WHERE { ?n minerva:relativePath "Jane Smith.md" ; foaf:mbox ?v . }
    `);
    expect((mbox.results as Array<{ v: string }>).map((r) => r.v)).toEqual(['jane@example.com']);

    const role = await queryGraph(ctx, `
      SELECT ?v WHERE { ?n minerva:relativePath "Jane Smith.md" ; minerva:meta-role ?v . }
    `);
    expect((role.results as Array<{ v: string }>).map((r) => r.v)).toEqual(['Engineer']);

    const org = await queryGraph(ctx, `
      SELECT ?v WHERE { ?n minerva:relativePath "Jane Smith.md" ; minerva:meta-organization ?v . }
    `);
    expect((org.results as Array<{ v: string }>).map((r) => r.v)).toEqual(['Acme']);
  });

  it('a Person instance is discoverable as foaf:Person via the class-level subClassOf', async () => {
    writeNote('Jane Smith.md', `---\ntitle: Jane Smith\ntype: person\n---\n`);
    await indexAllNotes(ctx);

    expect(await paths(
      `SELECT ?p WHERE { ?n minerva:relativePath ?p ; a/rdfs:subClassOf* foaf:Person }`,
    )).toEqual(['Jane Smith.md']);
  });
});
