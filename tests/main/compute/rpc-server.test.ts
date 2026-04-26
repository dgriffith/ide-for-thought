/**
 * Unit tests for the Minerva RPC server's dispatch layer (#242).
 *
 * These exercise the method table directly without standing up a
 * socket — the wire layer is a tiny stdin/stdout-style readline loop
 * over an `net.Socket`, and would just complicate the test for no
 * additional assurance. The Python-side socket wire is exercised
 * end-to-end in `python-library.test.ts` (it spawns a real kernel
 * and a real `minerva` import).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { dispatchMethod } from '../../../src/main/compute/rpc-server';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { initSearch, indexNote as searchIndex } from '../../../src/main/search/index';
import { initTablesDb } from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-rpc-server-test-'));
}

describe('rpc server method dispatch (#242)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    const ctx = projectContext(root);
    await initGraph(ctx);
    await initSearch(ctx);
    await initTablesDb(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('unknown method returns MethodNotFound', async () => {
    const r = await dispatchMethod(root, 'no.such', {});
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('MethodNotFound');
    }
  });

  it('notes.read returns frontmatter + tags + body', async () => {
    await fsp.writeFile(path.join(root, 'a.md'), '---\ntitle: Alpha\ntags: [x, y]\n---\n# Alpha\nBody text.\n', 'utf-8');
    const r = await dispatchMethod(root, 'notes.read', { relativePath: 'a.md' });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const note = r.result as Record<string, unknown>;
      expect(note.relativePath).toBe('a.md');
      expect(note.title).toBe('Alpha');
      expect(note.body).toContain('Body text.');
    }
  });

  it('notes.read on a missing path returns NotFoundError', async () => {
    const r = await dispatchMethod(root, 'notes.read', { relativePath: 'nope.md' });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('NotFoundError');
      expect(r.error.message).toMatch(/Note not found/);
    }
  });

  it('notes.by_tag returns tagged notes from the graph', async () => {
    const ctx = projectContext(root);
    await indexNote(ctx, 'p.md', '# P\n#alpha here\n');
    await indexNote(ctx, 'q.md', '# Q\n#beta here\n');

    const r = await dispatchMethod(root, 'notes.by_tag', { tag: 'alpha' });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const rows = r.result as Array<{ relativePath: string }>;
      expect(rows.map((x) => x.relativePath)).toContain('p.md');
      expect(rows.map((x) => x.relativePath)).not.toContain('q.md');
    }
  });

  it('notes.search returns search hits for a known token', async () => {
    const ctx = projectContext(root);
    const content = '# Foo\nThe quick brown fox.\n';
    await indexNote(ctx, 'foo.md', content);
    searchIndex(ctx, 'foo.md', content);

    const r = await dispatchMethod(root, 'notes.search', { query: 'brown' });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const rows = r.result as Array<{ relativePath: string }>;
      expect(rows.some((x) => x.relativePath === 'foo.md')).toBe(true);
    }
  });

  it('sparql wraps queryGraph results under {rows}', async () => {
    const ctx = projectContext(root);
    await indexNote(ctx, 's.md', '# Sparkle\nbody.\n');
    const r = await dispatchMethod(root, 'sparql', {
      query: 'SELECT ?t WHERE { ?n minerva:relativePath "s.md" ; dc:title ?t . }',
    });
    expect('result' in r).toBe(true);
    if ('result' in r) {
      const out = r.result as { rows: Array<{ t: string }> };
      expect(out.rows.length).toBe(1);
      expect(out.rows[0].t).toBe('Sparkle');
    }
  });

  it('sparql with a parse error returns QueryError', async () => {
    const r = await dispatchMethod(root, 'sparql', { query: 'SELECT WHERE {' });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('QueryError');
    }
  });

  it('sources.get returns NotFoundError for unknown id', async () => {
    const r = await dispatchMethod(root, 'sources.get', { sourceId: 'missing-2024' });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('NotFoundError');
    }
  });

  it('typed-arg failure surfaces as TypeError', async () => {
    const r = await dispatchMethod(root, 'sparql', { query: 42 });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('TypeError');
    }
  });
});
