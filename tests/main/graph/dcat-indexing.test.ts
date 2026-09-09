import { describe, it, expect, beforeEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { indexNote, indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('DCAT alignment (#2033)', () => {
  const project = useGraphProject('minerva-dcat-index-test-');
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = project.root;
    ctx = project.ctx;
  });

  it('types the thoughtbase root as dcat:Catalog alongside minerva:Project', async () => {
    // ensureProject() (which stamps the project node) only runs on a full
    // rebuild, not a single indexNote() call — plant a file on disk and
    // rebuild, matching the pattern in cold-snapshot.test.ts.
    await fsp.writeFile(path.join(root, 'note.md'), '# Hello\n', 'utf-8');
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `
      SELECT ?type WHERE {
        ?p a minerva:Project ; a ?type .
      }
    `);
    const types = (results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('https://minerva.dev/ontology#Project');
    expect(types).toContain('http://www.w3.org/ns/dcat#Catalog');
  });

  it('types a markdown note as dcat:Dataset alongside minerva:Note', async () => {
    await indexNote(ctx, 'note.md', '# Hello\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?type WHERE {
        ?m minerva:relativePath "note.md" ; a ?type .
      }
    `);
    const types = (results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('https://minerva.dev/ontology#Note');
    expect(types).toContain('http://www.w3.org/ns/dcat#Dataset');
  });

  it('types a non-markdown note (.py) as dcat:Dataset alongside its extra typing', async () => {
    await indexNote(ctx, 'helpers.py', 'def add(a, b):\n    return a + b\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?type WHERE {
        ?m minerva:relativePath "helpers.py" ; a ?type .
      }
    `);
    const types = (results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('https://minerva.dev/ontology#PythonModule');
    expect(types).toContain('http://www.w3.org/ns/dcat#Dataset');
  });

  it('links the catalog to each note via the standard dcat:dataset predicate', async () => {
    await fsp.writeFile(path.join(root, 'note.md'), '# Hello\n', 'utf-8');
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `
      SELECT ?d WHERE {
        ?catalog a dcat:Catalog ; dcat:dataset ?d .
        ?d minerva:relativePath "note.md" .
      }
    `);
    expect((results as Array<{ d: string }>).length).toBe(1);
  });
});
