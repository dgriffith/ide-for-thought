/**
 * @vitest-environment node
 *
 * Object types map onto a thoughtbase's imported vocabularies (#2792): an
 * `externalClass:` or property `predicate:` naming `lab:` applies once `lab:`
 * is imported, importing or removing it reindexes so the mapping follows, and
 * a CURIE whose prefix nobody declares is reported rather than skipped.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  commitVocabularyImport,
  indexAllNotes,
  initGraph,
  previewVocabularyImport,
  queryGraph,
  removeVocabulary,
  typeMappingProblems,
} from '../../../src/main/graph/index';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import { USER_ONTOLOGY_DIR } from '../../../src/shared/ontology-vocabularies';
import { useGraphProject } from '../../helpers/temp-project';

const LAB = [
  '@prefix lab: <https://lab.example/ns#> .',
  '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
  'lab:Sample a rdfs:Class ; rdfs:label "Sample" .',
  'lab:collectedOn a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> ; rdfs:label "collected on" .',
  '',
].join('\n');

const SPECIMEN = [
  '---',
  'label: Specimen',
  'externalClass: lab:Sample',
  'properties:',
  '  - name: collected',
  '    type: date',
  '    predicate: lab:collectedOn',
  '---',
  '',
].join('\n');

/** In full IRIs, so it means the same whether or not `lab:` is imported. */
const SAMPLES = `SELECT ?note ?when WHERE {
  ?note a/rdfs:subClassOf* <https://lab.example/ns#Sample> .
  OPTIONAL { ?note <https://lab.example/ns#collectedOn> ?when }
}`;

describe('types mapped onto an imported vocabulary (#2792)', () => {
  const project = useGraphProject('minerva-type-mappings-');
  const write = (rel: string, text: string) => {
    const abs = path.join(project.root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  const samples = async () => {
    const r = await queryGraph(project.ctx, SAMPLES);
    if (!r.ok) throw new Error(r.error);
    return r.results.map((row) => [row.note?.split('/').pop(), row.when ?? null]);
  };
  const problems = async () => typeMappingProblems(project.ctx, await loadTypeCatalog(project.root)).map((e) => e.message);

  beforeEach(() => {
    write('.minerva/types/specimen.md', SPECIMEN);
    write('moss.md', '---\ntype: specimen\ncollected: 2026-05-01\n---\n# Moss\n');
  });

  it('with the vocabulary imported, the class and the predicate apply', async () => {
    write(`${USER_ONTOLOGY_DIR}/lab.ttl`, LAB);
    await initGraph(project.ctx);
    await indexAllNotes(project.ctx);
    const [row] = await samples();
    expect(row![0]).toMatch(/moss/);
    expect(row![1]).toMatch(/^2026-05-01/);
    expect(await problems()).toEqual([]);
  });

  it('without it, neither applies, and both are reported', async () => {
    await initGraph(project.ctx);
    await indexAllNotes(project.ctx);
    expect(await samples()).toEqual([]);
    expect(await problems()).toEqual([
      'externalClass "lab:Sample": "lab:" isn\'t a standard prefix or one this thoughtbase imports (Settings → Ontology), so the mapping doesn\'t apply',
      'property "collected" predicate "lab:collectedOn": "lab:" isn\'t a standard prefix or one this thoughtbase imports (Settings → Ontology), so the mapping doesn\'t apply',
    ]);
  });

  it('importing it reindexes, so the mapping applies at once; removing it takes the mapping away again', async () => {
    await initGraph(project.ctx);
    await indexAllNotes(project.ctx);
    expect(await samples()).toEqual([]);

    const preview = await previewVocabularyImport(project.ctx, 'lab.ttl', LAB);
    await commitVocabularyImport(project.ctx, preview.id);
    expect((await samples()).map((r) => r[0])).toEqual([expect.stringMatching(/moss/)]);

    await removeVocabulary(project.ctx, 'lab.ttl');
    expect(await samples()).toEqual([]);
  });

  it('a standard prefix still resolves, and a CURIE with no prefix is reported as such', async () => {
    write('.minerva/types/specimen.md', SPECIMEN.replace('lab:Sample', 'foaf:Document').replace('lab:collectedOn', 'nocolon'));
    await initGraph(project.ctx);
    expect(await problems()).toEqual(['property "collected" predicate "nocolon" isn\'t a CURIE (prefix:term), so the mapping doesn\'t apply']);
  });
});
