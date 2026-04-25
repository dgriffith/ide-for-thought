import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { executeSparql } from '../../../src/main/compute/executors/sparql';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-sparql-exec-test-'));
}

describe('executeSparql (#239)', () => {
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

  it('returns a typed table output with columns taken from the first binding', async () => {
    await indexNote(ctx, 'foo.md', '---\ntitle: "Foo"\n---\n\nhi');
    await indexNote(ctx, 'bar.md', '---\ntitle: "Bar"\n---\n\nhi');

    const result = await executeSparql(
      'SELECT ?title ?path WHERE { ?n a minerva:Note . ?n dc:title ?title . ?n minerva:relativePath ?path } ORDER BY ?title',
      { rootPath: root },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.type).toBe('table');
    if (result.output.type !== 'table') return;
    expect(result.output.columns).toEqual(['title', 'path']);
    expect(result.output.rows).toEqual([
      ['Bar', 'bar.md'],
      ['Foo', 'foo.md'],
    ]);
  });

  it('returns an empty table (no columns, no rows) when the query matches nothing', async () => {
    const result = await executeSparql(
      'SELECT ?x WHERE { ?x minerva:definitelyDoesNotExist "nope" }',
      { rootPath: root },
    );
    expect(result).toEqual({
      ok: true,
      output: { type: 'table', columns: [], rows: [] },
    });
  });

  it('surfaces SPARQL syntax errors as ok:false rather than throwing', async () => {
    // Unclosed WHERE clause — the parser bails; queryGraph surfaces the
    // error through its response envelope rather than throwing.
    const result = await executeSparql('SELECT ?x WHERE { ?x ?p', { rootPath: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/parse/i);
  });
});
