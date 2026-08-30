/**
 * search_notes tool (#1935) — thin wrapper over the MiniSearch full-text
 * index. Covers a hit with a snippet, the "no results" message, and the
 * missing-query error (thrown from the tool and wrapped by the dispatcher).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { executeNotebaseTool, NOTEBASE_TOOLS } from '../../../src/main/llm/tools';
import * as search from '../../../src/main/search/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { useTempDir } from '../../helpers/temp-project';

const project = useTempDir('minerva-search-notes-');
let ctx: ProjectContext;

beforeEach(async () => {
  fs.mkdirSync(path.join(project.root, '.minerva'), { recursive: true });
  ctx = projectContext(project.root);
  await search.initSearch(ctx);
});
afterEach(() => {
  search.disposeProject(ctx);
});

describe('search_notes tool execution', () => {
  it('returns ranked results with title, path, and a snippet', async () => {
    fs.writeFileSync(path.join(project.root, 'cats.md'), '# Cats\nCats are feline animals that purr and hunt mice.\n', 'utf-8');
    await search.indexAllNotes(ctx);

    const out = await executeNotebaseTool(ctx, 'search_notes', { query: 'feline animals' });
    expect(out.isError).toBe(false);
    expect(out.content).toContain('Cats (cats.md)');
    expect(out.content).toMatch(/^1\./);
  });

  it('honors the limit option', async () => {
    fs.writeFileSync(path.join(project.root, 'a.md'), '# A\ngardening soil plants\n', 'utf-8');
    fs.writeFileSync(path.join(project.root, 'b.md'), '# B\ngardening soil plants\n', 'utf-8');
    await search.indexAllNotes(ctx);

    const out = await executeNotebaseTool(ctx, 'search_notes', { query: 'gardening', limit: 1 });
    expect(out.isError).toBe(false);
    expect((out.content.match(/^\d+\. /gm) ?? []).length).toBe(1);
  });

  it('reports no results clearly', async () => {
    await search.indexAllNotes(ctx);
    const out = await executeNotebaseTool(ctx, 'search_notes', { query: 'zzz-not-present' });
    expect(out.isError).toBe(false);
    expect(out.content).toBe('No results for "zzz-not-present".');
  });

  it('requires a non-empty query', async () => {
    const out = await executeNotebaseTool(ctx, 'search_notes', { query: '  ' });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/Tool search_notes failed: query is required/);
  });

  it('is registered in the default conversation toolset', () => {
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('search_notes');
  });
});
