import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { isIndexable, INDEXABLE_EXTS } from '../../../src/main/notebase/indexable-files';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-py-index-test-'));
}

describe('Python file indexing', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('treats .py as indexable', () => {
    expect(isIndexable('helpers.py')).toBe(true);
    expect(isIndexable('subdir/utils.py')).toBe(true);
    expect(INDEXABLE_EXTS.has('.py')).toBe(true);
  });

  it('emits the file as both a minerva:Note and a minerva:PythonModule', async () => {
    await indexNote(ctx, 'python/helpers.py', 'def add(a, b):\n    return a + b\n');

    const { results } = await queryGraph(ctx, `
      SELECT ?type WHERE {
        ?m minerva:relativePath "python/helpers.py" ;
           a ?type .
      }
    `);
    const types = (results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('https://minerva.dev/ontology#Note');
    expect(types).toContain('https://minerva.dev/ontology#PythonModule');
  });

  it('records title / filename / relativePath stripped of the .py extension', async () => {
    await indexNote(ctx, 'python/helpers.py', '# anything\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?title ?filename ?relPath WHERE {
        ?m minerva:relativePath "python/helpers.py" ;
           minerva:relativePath ?relPath ;
           minerva:filename ?filename ;
           dc:title ?title .
      }
    `);
    expect(results as Array<{ title: string; filename: string; relPath: string }>).toEqual([
      { title: 'helpers', filename: 'helpers.py', relPath: 'python/helpers.py' },
    ]);
  });

  it('records folder + project membership', async () => {
    await indexNote(ctx, 'python/utils.py', 'x = 1\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?folder WHERE {
        ?m minerva:relativePath "python/utils.py" ;
           minerva:inFolder ?folder .
      }
    `);
    const folders = (results as Array<{ folder: string }>).map((r) => r.folder);
    expect(folders.some((f) => f.endsWith('/folder/python'))).toBe(true);

    const project = await queryGraph(ctx, `
      SELECT ?p WHERE {
        ?p minerva:containsNote ?m . ?m minerva:relativePath "python/utils.py" .
      }
    `);
    expect((project.results as Array<{ p: string }>).length).toBe(1);
  });

  it('does not crash on syntactically invalid Python (no AST parsing)', async () => {
    // The indexer must not parse content — broken syntax should still
    // produce well-formed metadata so the file shows up in listings.
    await indexNote(ctx, 'broken.py', 'def (((:\n   syntax error here\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?type WHERE { ?m minerva:relativePath "broken.py" ; a ?type . }
    `);
    const types = (results as Array<{ type: string }>).map((r) => r.type);
    expect(types).toContain('https://minerva.dev/ontology#PythonModule');
  });

  it('does not extract markdown-isms (wiki-links, tags) from .py content', async () => {
    // A .py file that happens to contain `[[foo]]` or `#tag` in
    // comments must not get those indexed as graph links/tags — that
    // would emit phantom relations the user never wrote.
    await indexNote(ctx, 'tricky.py', '# [[NotALink]] and #not-a-tag\nx = 1\n');
    const { results } = await queryGraph(ctx, `
      SELECT ?tag WHERE {
        ?m minerva:relativePath "tricky.py" ;
           minerva:hasTag ?tag .
      }
    `);
    expect(results).toEqual([]);
  });
});
