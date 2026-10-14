/**
 * @vitest-environment node
 *
 * A thoughtbase's own vocabularies in the graph (#2788): loaded at open and on
 * rebuild, beside the built-in ontology — their prefixes in every query and in
 * completion, their terms in completion, none of it in `graph.ttl` — and
 * imported and removed from Settings → Ontology.
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
  schemaForCompletion,
  serializeUserGraph,
  syncVocabularies,
} from '../../../src/main/graph/index';
import { onGraphChanged } from '../../../src/main/graph/graph-events';
import { vocabularyFileName } from '../../../src/main/graph/user-ontology';
import { USER_ONTOLOGY_DIR } from '../../../src/shared/ontology-vocabularies';
import { useGraphProject } from '../../helpers/temp-project';

const LAB = [
  '@prefix lab: <https://lab.example/ns#> .',
  '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
  'lab:Sample a rdfs:Class ; rdfs:label "Sample" .',
  'lab:collectedOn a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> ; rdfs:label "collected on" .',
  '',
].join('\n');

/** Written in full, so it means the same whether or not the vocabulary is loaded. */
const QUERY_LAB = 'SELECT ?label WHERE { <https://lab.example/ns#Sample> rdfs:label ?label }';

describe('a thoughtbase\'s own vocabularies (#2788)', () => {
  const project = useGraphProject('minerva-user-ontology-');
  const dir = () => path.join(project.root, USER_ONTOLOGY_DIR);
  const write = (file: string, text: string) => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), file), text);
  };
  const labels = async () => {
    const r = await queryGraph(project.ctx, QUERY_LAB);
    if (!r.ok) throw new Error(r.error);
    return r.results.map((row) => row.label);
  };

  beforeEach(() => { write('lab.ttl', LAB); });

  it('loads at project open: its prefix works with no PREFIX line, and completion offers it', async () => {
    await initGraph(project.ctx);
    expect(await labels()).toEqual(['Sample']);
    const r = await queryGraph(project.ctx, 'SELECT ?label WHERE { lab:Sample rdfs:label ?label }');
    expect(r.ok && r.results).toEqual([{ label: 'Sample' }]);
    const schema = schemaForCompletion(project.ctx);
    expect(schema.prefixes).toContainEqual({ prefix: 'lab', iri: 'https://lab.example/ns#' });
    // Declared, not yet used by any note — still offered.
    expect(schema.classes).toContainEqual({ iri: 'https://lab.example/ns#Sample', prefixed: 'lab:Sample' });
    expect(schema.predicates).toContainEqual({ iri: 'https://lab.example/ns#collectedOn', prefixed: 'lab:collectedOn' });
  });

  it('never reaches graph.ttl, as the built-in ontology doesn\'t', async () => {
    await initGraph(project.ctx);
    expect(serializeUserGraph(project.ctx)).not.toContain('lab.example');
  });

  it('a query that declares the prefix itself still runs', async () => {
    await initGraph(project.ctx);
    const r = await queryGraph(project.ctx, 'PREFIX lab: <https://lab.example/ns#>\nSELECT ?label WHERE { lab:Sample rdfs:label ?label }');
    expect(r.ok && r.results).toEqual([{ label: 'Sample' }]);
  });

  it('a rebuild keeps them, and picks up a file edited outside the app', async () => {
    await initGraph(project.ctx);
    write('lab.ttl', LAB.replace('"Sample"', '"Specimen"'));
    await indexAllNotes(project.ctx);
    expect(await labels()).toEqual(['Specimen']);
  });

  it('a refused file is skipped and reported, and the graph loads anyway', async () => {
    write('broken.ttl', 'this is not turtle');
    write('rebind.ttl', '@prefix skos: <https://attacker.example/#> .\n');
    await initGraph(project.ctx);
    expect(await labels()).toEqual(['Sample']);
    const statuses = await syncVocabularies(project.ctx);
    expect(statuses.map((s) => [s.file, s.ok])).toEqual([['broken.ttl', false], ['lab.ttl', true], ['rebind.ttl', false]]);
  });

  it('skips a link: a vocabulary is a file the thoughtbase holds', async () => {
    const outside = path.join(project.root, '..', `outside-${path.basename(project.root)}.ttl`);
    fs.writeFileSync(outside, LAB.replace('"Sample"', '"Linked"'));
    try {
      fs.rmSync(path.join(dir(), 'lab.ttl'));
      fs.symlinkSync(outside, path.join(dir(), 'linked.ttl'));
      expect(await syncVocabularies(project.ctx)).toEqual([]);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('an unreadable folder is reported, and the graph loads anyway', async () => {
    fs.chmodSync(dir(), 0o000);
    try {
      await initGraph(project.ctx);
      expect(await syncVocabularies(project.ctx)).toEqual([
        { file: USER_ONTOLOGY_DIR, ok: false, problems: [expect.stringMatching(/^The folder couldn't be read \(EACCES\)\.$/)] },
      ]);
    } finally {
      fs.chmodSync(dir(), 0o755);
    }
  });

  it('sync reloads only when the folder changed, and announces it', async () => {
    await initGraph(project.ctx);
    let changes = 0;
    const off = onGraphChanged(() => { changes += 1; });
    try {
      await syncVocabularies(project.ctx);
      expect(changes).toBe(0);
      fs.rmSync(path.join(dir(), 'lab.ttl'));
      expect(await syncVocabularies(project.ctx)).toEqual([]);
      expect(changes).toBe(1);
      expect(await labels()).toEqual([]);
      expect(schemaForCompletion(project.ctx).prefixes.map((p) => p.prefix)).not.toContain('lab');
      const unknown = await queryGraph(project.ctx, 'SELECT ?l WHERE { lab:Sample rdfs:label ?l }');
      expect(unknown).toMatchObject({ ok: false, error: expect.stringContaining('Unknown prefix: lab') });
    } finally {
      off();
    }
  });

  describe('Import Turtle… and Remove', () => {
    beforeEach(async () => {
      fs.rmSync(path.join(dir(), 'lab.ttl'));
      await initGraph(project.ctx);
    });

    it('previews without writing, then saves exactly the previewed text and loads it', async () => {
      const preview = await previewVocabularyImport(project.ctx, '/somewhere/Lab Schema.TTL', LAB);
      expect(preview).toMatchObject({ file: 'lab-schema.ttl', replaces: false, status: { ok: true } });
      expect(fs.existsSync(path.join(dir(), 'lab-schema.ttl'))).toBe(false);
      const statuses = await commitVocabularyImport(project.ctx, preview.id);
      expect(statuses.map((s) => s.file)).toEqual(['lab-schema.ttl']);
      expect(fs.readFileSync(path.join(dir(), 'lab-schema.ttl'), 'utf-8')).toBe(LAB);
      expect(await labels()).toEqual(['Sample']);
    });

    it('a file of the same name is replaced, and checked without the one it replaces', async () => {
      await commitVocabularyImport(project.ctx, (await previewVocabularyImport(project.ctx, 'lab.ttl', LAB)).id);
      // Relabelling would contradict lab.ttl — except lab.ttl is what it replaces.
      const preview = await previewVocabularyImport(project.ctx, 'lab.ttl', LAB.replace('"Sample"', '"Specimen"'));
      expect(preview).toMatchObject({ replaces: true, status: { ok: true } });
      await commitVocabularyImport(project.ctx, preview.id);
      expect(await labels()).toEqual(['Specimen']);
    });

    it('a refused file is previewed with its problems and can\'t be committed', async () => {
      const preview = await previewVocabularyImport(project.ctx, 'x.ttl', '@prefix skos: <https://attacker.example/#> .\n');
      expect(preview.status).toMatchObject({ ok: false, problems: [expect.stringContaining('standard prefix skos:')] });
      await expect(commitVocabularyImport(project.ctx, preview.id)).rejects.toThrow(/x\.ttl can't be imported: It binds the standard prefix skos:/);
      expect(fs.existsSync(path.join(dir(), 'x.ttl'))).toBe(false);
    });

    it('commit checks again: a conflicting file that arrived since is refused', async () => {
      const preview = await previewVocabularyImport(project.ctx, 'lab.ttl', LAB);
      write('arrived.ttl', '<https://lab.example/ns#Sample> <http://www.w3.org/2000/01/rdf-schema#label> "Other" .');
      await expect(commitVocabularyImport(project.ctx, preview.id)).rejects.toThrow(/arrived\.ttl says "Other"/);
    });

    it('only the import awaiting confirmation can be committed, and only once', async () => {
      const first = await previewVocabularyImport(project.ctx, 'a.ttl', LAB);
      const second = await previewVocabularyImport(project.ctx, 'b.ttl', LAB);
      await expect(commitVocabularyImport(project.ctx, first.id)).rejects.toThrow(/no longer waiting/);
      await commitVocabularyImport(project.ctx, second.id);
      await expect(commitVocabularyImport(project.ctx, second.id)).rejects.toThrow(/no longer waiting/);
    });

    it('Remove deletes the file and takes its terms out; it acts only on a plain file name', async () => {
      await commitVocabularyImport(project.ctx, (await previewVocabularyImport(project.ctx, 'lab.ttl', LAB)).id);
      expect(await removeVocabulary(project.ctx, 'lab.ttl')).toEqual([]);
      expect(await labels()).toEqual([]);
      for (const bad of ['../graph.ttl', '../../x.ttl', '.hidden.ttl', 'lab.txt', 'a/b.ttl']) {
        await expect(removeVocabulary(project.ctx, bad)).rejects.toThrow(/isn't a vocabulary file name/);
      }
    });
  });

  it('vocabularyFileName makes a plain .ttl name', () => {
    expect(vocabularyFileName('/x/My Lab Schema.TTL')).toBe('my-lab-schema.ttl');
    expect(vocabularyFileName('..ttl')).toBe('vocabulary.ttl');
    expect(vocabularyFileName('a/b/../../FOAF (2014).rdf.ttl')).toBe('foaf-2014.rdf.ttl');
  });
});
