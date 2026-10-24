/**
 * Running SHACL shapes as inspections against a real graph (#2642): findings
 * worded for a reader, a check switched off costing nothing, the finding cap
 * — and the two guarantees a plugin's shape lives under: it can't change the
 * graph, and it can't reach the network.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import N3 from 'n3';
import { indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { parseShapesFile, type ShapesFile } from '../../../src/main/graph/shacl/shapes';
import { readOnlyDataset, runShaclChecks, SHACL_CHECK_MAX_FINDINGS } from '../../../src/main/graph/shacl/run';
import { useGraphProject } from '../../helpers/temp-project';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('graph');

const P = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/shapes#> .
@prefix minerva: <https://minerva.dev/ontology#> .
@prefix types: <https://minerva.dev/ontology/types#> .
`;
function shapes(ttl: string): ShapesFile {
  const r = parseShapesFile(P + ttl, { kind: 'plugin', id: 'lab', name: 'Lab' });
  if (!r.ok) throw new Error(r.problems.join('\n'));
  return r.file;
}

const project = useGraphProject('minerva-shacl-run-');
function write(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(project.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(project.root, rel), content);
}

beforeEach(async () => {
  write('books/Walden.md', '---\ntype: book\ntitle: Walden\n---\n# Walden\n');
  write('books/Meditations.md', '---\ntype: book\ntitle: Meditations\nauthor: Marcus Aurelius\n---\n# Meditations\n');
  await indexAllNotes(project.ctx);
});

const NEEDS_AUTHOR = `
  ex:NeedsAuthor a sh:NodeShape ; sh:targetClass types:Book ; sh:severity sh:Warning ;
    sh:message "\\"{$this}\\" has no author" ; minerva:suggestedAction "Add who wrote {$this}" ;
    sh:property [ sh:path <http://purl.org/dc/terms/creator> ; sh:minCount 1 ] .`;

describe('runShaclChecks (#2642)', () => {
  it("reports each node a shape's constraints fail, by its label and note, with the shape's words", async () => {
    const found = await runShaclChecks(project.ctx, [shapes(NEEDS_AUTHOR)], () => true);
    expect(found).toEqual([expect.objectContaining({
      type: 'plugin:lab/NeedsAuthor', severity: 'warning', nodeLabel: 'Walden', notePath: 'books/Walden.md',
      message: '"Walden" has no author', suggestedAction: 'Add who wrote Walden',
    })]);
  });

  it("a SPARQL constraint's {?var} reads as text: a literal quoted, an IRI as its label", async () => {
    const found = await runShaclChecks(project.ctx, [shapes(`
      ex: sh:declare [ sh:prefix "dc" ; sh:namespace "http://purl.org/dc/terms/" ] .
      ex:Named a sh:NodeShape ; sh:targetClass types:Book ; sh:severity sh:Info ;
        sh:sparql [ sh:prefixes ex: ; sh:message "{?title} is {$this}" ;
          sh:select "SELECT $this ?title WHERE { $this dc:title ?title FILTER(?title = 'Walden') }" ] .`)], () => true);
    expect(found.map((f) => f.message)).toEqual(['"Walden" is Walden']);
  });

  it('runs nothing for a check that is switched off', async () => {
    expect(await runShaclChecks(project.ctx, [shapes(NEEDS_AUTHOR)], () => false)).toEqual([]);
  });

  it(`reports at most ${SHACL_CHECK_MAX_FINDINGS} findings for one check`, async () => {
    for (let i = 0; i < SHACL_CHECK_MAX_FINDINGS + 5; i++) write(`many/n${i}.md`, `# Note ${i}\n`);
    await indexAllNotes(project.ctx);
    const found = await runShaclChecks(project.ctx, [shapes(`
      ex:Everything a sh:NodeShape ; sh:targetSubjectsOf minerva:relativePath ;
        sh:property [ sh:path ex:never ; sh:minCount 1 ] .`)], () => true);
    expect(found).toHaveLength(SHACL_CHECK_MAX_FINDINGS);
  });
});

describe('a shape only reads (#2642)', () => {
  it('the dataset a shape validates refuses every write', () => {
    const store = new N3.Store();
    const view = readOnlyDataset(store);
    const q = N3.DataFactory.quad(N3.DataFactory.namedNode('a:s'), N3.DataFactory.namedNode('a:p'), N3.DataFactory.literal('o'));
    for (const write of [() => view.add(q), () => view.addQuad(q), () => view.delete(q), () => view.removeMatches(), () => view.addQuads([q])]) {
      expect(write).toThrow('A SHACL shape tried to change the graph');
    }
    expect(store.size).toBe(0);
    expect([...view.match()]).toEqual([]);
  });

  it('an Update that got past the file check still changes nothing: the check reports nothing, the others run', async () => {
    // Built by hand: parseShapesFile would have refused it.
    const evil = new N3.Parser().parse(P + `ex:Evil a sh:NodeShape ; sh:targetClass types:Book ;
      sh:sparql [ sh:select """INSERT DATA { <https://example.org/x> <https://example.org/p> "owned" }""" ] .`);
    const file: ShapesFile = { quads: evil, checks: [{ type: 'plugin:lab/Evil', shape: 'https://example.org/shapes#Evil', label: 'Evil', description: '', group: 'plugins', severity: 'concern', message: null, suggestedAction: null }] };
    const found = await runShaclChecks(project.ctx, [file, shapes(NEEDS_AUTHOR)], () => true);
    expect(found.map((f) => f.type)).toEqual(['plugin:lab/NeedsAuthor']);
    const owned = await queryGraph(project.ctx, 'ASK { ?s ?p "owned" }');
    expect(owned.ok && owned.results.length === 0 || JSON.stringify(owned).includes('false')).toBe(true);
  });

  describe('the network', () => {
    let hits = 0;
    const server = http.createServer((_req, res) => { hits += 1; res.end('<> <a:p> "x" .'); });
    const listening = new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
    afterAll(() => server.close());

    it('a SERVICE or FROM in a shape reaches nothing: the validator has no HTTP actor', async () => {
      const port = await listening;
      const url = `http://127.0.0.1:${port}/sparql`;
      const file = shapes(`
        ex:Service a sh:NodeShape ; sh:targetClass types:Book ;
          sh:sparql [ sh:select "SELECT $this WHERE { SERVICE <${url}> { $this ?p ?o } }" ] .
        ex:From a sh:NodeShape ; sh:targetClass types:Book ;
          sh:sparql [ sh:select "SELECT $this FROM <${url}> WHERE { $this ?p ?o }" ] .`);
      await runShaclChecks(project.ctx, [file], () => true);
      expect(hits).toBe(0);
    });
  });
});
