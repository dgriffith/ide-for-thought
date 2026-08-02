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
import { initGraph, indexAllNotes, queryGraph, getNoteTypedProperties, getTypeInstances } from '../../../src/main/graph/index';
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
  writeType('reference', `label: Reference\nproperties:\n  - name: citation\n    type: text`);
  writeType('monograph', `label: Monograph\nparent: reference\nproperties:\n  - name: isbn\n    type: text`);
  writeNote('Dune.md', `---\ntitle: Dune\ntype: monograph\ncitation: Herbert 1965\nisbn: "9780441172719"\n---\n`); // a Monograph (⊂ Reference)
  writeNote('Cite.md', `---\ntitle: Cite\ntype: reference\ncitation: Smith 2020\n---\n`); // a direct Reference
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
    // Dune is typed Monograph, not directly Reference.
    expect(await paths(`SELECT ?p WHERE { ?n minerva:relativePath ?p ; a types:Reference }`)).toEqual(['Cite.md']);
    expect(await paths(`SELECT ?p WHERE { ?n minerva:relativePath ?p ; a types:Monograph }`)).toEqual(['Dune.md']);
  });

  it('the read-back inherits the parent\'s properties (#1587)', async () => {
    const rb = await getNoteTypedProperties(ctx, 'Dune.md');
    expect(rb.type?.id).toBe('monograph');
    // citation is inherited from Reference; isbn is the Monograph's own.
    const byName = new Map(rb.properties.map((p) => [p.name, p]));
    expect([...byName.keys()]).toEqual(['citation', 'isbn']); // ancestor-first
    expect(byName.get('citation')!.value).toBe('Herbert 1965');
    expect(byName.get('isbn')!.value).toContain('9780441172719');
  });

  it('the multi-view is subclass-aware and inherits columns (#1587)', async () => {
    // The parent's view shows the parent's columns and INCLUDES subclass instances.
    const ref = await getTypeInstances(ctx, 'reference');
    expect(ref.instances.map((i) => i.path).sort()).toEqual(['Cite.md', 'Dune.md']);
    // The subclass's view carries inherited + own columns.
    const mono = await getTypeInstances(ctx, 'monograph');
    const dune = mono.instances.find((i) => i.path === 'Dune.md')!;
    expect(Object.keys(dune.values).sort()).toEqual(['citation', 'isbn']);
    expect(dune.values.citation).toBe('Herbert 1965');
  });
});
