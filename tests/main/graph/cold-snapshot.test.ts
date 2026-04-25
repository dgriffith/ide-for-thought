/**
 * #348: graph.ttl is a cold snapshot.
 *
 *  - indexNote does NOT trip per-write serialization (we used to debounce
 *    persistGraph on every keystroke; now the in-memory store is the
 *    source of truth and graph.ttl is only refreshed on
 *    persistGraph(ctx) — i.e. release / quit).
 *  - The graph rebuilds correctly from sources when graph.ttl is absent
 *    (initGraph + indexAllNotes is the cold-start path).
 *  - persistGraph still works on demand (release path) and writes the
 *    live store to graph.ttl.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  queryGraph,
  persistGraph,
  indexAllNotes,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cold-snapshot-test-'));
}

describe('graph.ttl cold-snapshot semantics (#348)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('indexNote does not write graph.ttl', async () => {
    const graphPath = path.join(root, '.minerva', 'graph.ttl');
    await indexNote(ctx, 'a.md', '# Alpha\n');
    expect(fs.existsSync(graphPath)).toBe(false);
  });

  it('many indexNote calls do not write graph.ttl', async () => {
    const graphPath = path.join(root, '.minerva', 'graph.ttl');
    for (let i = 0; i < 20; i++) {
      await indexNote(ctx, `n${i}.md`, `# n${i}\nbody\n`);
    }
    expect(fs.existsSync(graphPath)).toBe(false);
  });

  it('persistGraph writes graph.ttl with the current store contents', async () => {
    await indexNote(ctx, 'a.md', '# Alpha\n');
    await persistGraph(ctx);
    const graphPath = path.join(root, '.minerva', 'graph.ttl');
    const ttl = await fsp.readFile(graphPath, 'utf-8');
    // Snapshot should contain the indexed note's title literal.
    expect(ttl).toContain('Alpha');
  });

  it('rebuilds the in-memory graph from sources when graph.ttl is absent', async () => {
    // Plant a note on disk so indexAllNotes has something to find.
    await fsp.writeFile(path.join(root, 'a.md'), '# Alpha\n', 'utf-8');
    expect(fs.existsSync(path.join(root, '.minerva', 'graph.ttl'))).toBe(false);

    // Cold start: no persisted graph, but indexAllNotes rebuilds.
    const count = await indexAllNotes(ctx);
    expect(count).toBeGreaterThanOrEqual(1);

    const r = await queryGraph(ctx, `
      SELECT ?t WHERE {
        ?n minerva:relativePath "a.md" ;
           dc:title ?t .
      }
    `);
    expect((r.results as Array<{ t: string }>)[0].t).toBe('Alpha');

    // And it STILL didn't write graph.ttl on its own — that's release-only now.
    expect(fs.existsSync(path.join(root, '.minerva', 'graph.ttl'))).toBe(false);
  });

  it('snapshot survives between sessions: write, init from disk, query reads from snapshot', async () => {
    // Session 1: index a note + persist explicitly.
    await indexNote(ctx, 'persisted.md', '# Persisted\n');
    await persistGraph(ctx);

    // Session 2: a fresh ctx (different rootPath would normally apply,
    // but the same path is fine — we're emulating "app reopens project").
    // Drop the in-memory state so the next initGraph reads from disk.
    const ctx2 = projectContext(root);
    await initGraph(ctx2); // re-reads .minerva/graph.ttl

    // The persisted note's metadata is in the store BEFORE indexAllNotes
    // runs — that's the whole point of having a snapshot.
    const r = await queryGraph(ctx2, `
      SELECT ?t WHERE {
        ?n minerva:relativePath "persisted.md" ;
           dc:title ?t .
      }
    `);
    expect((r.results as Array<{ t: string }>)[0]?.t).toBe('Persisted');
  });
});
