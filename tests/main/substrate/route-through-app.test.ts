/**
 * Route-through-the-running-app (#1524, epic #1145 — Substrate).
 *
 * The app advertises a loopback endpoint per open thoughtbase; a CLI/MCP client
 * routes the two ops that must not race the app — `proposeNote` (single writer
 * on the graph) and `semantic` (the DuckDB lock-holder, #1272) — through it,
 * and falls back to the direct in-process path when no live app is present.
 *
 * These tests play both roles in one process: the "app" (registerProject + live
 * graph/vector state) and the "client" (a routed engine hitting localhost). A
 * dispatch counter proves whether a call actually routed or fell back.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRoutedEngine } from '../../../src/cli/routed-engine';
import * as appServer from '../../../src/main/substrate/app-server';
import * as graph from '../../../src/main/graph/index';
import * as store from '../../../src/main/embeddings/vector-store';
import type { ChunkEmbedder } from '../../../src/main/embeddings/vector-store';
import { MODEL } from '../../../src/main/embeddings/embedder';
import { onProposalsChanged } from '../../../src/main/llm/proposal-events';
import { RUNTIME_FILE } from '../../../src/main/substrate/protocol';
import { projectContext } from '../../../src/main/project-context-types';

/** Deterministic hashing embedder — no WASM model load (mirrors run.test.ts). */
function fakeEmbedder(): ChunkEmbedder {
  return {
    dim: MODEL.dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((t) => {
        const v = new Float32Array(MODEL.dim);
        for (const w of t.toLowerCase().split(/\W+/).filter(Boolean)) {
          let h = 0;
          for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % MODEL.dim] += 1;
        }
        const n = Math.hypot(...v);
        if (n > 0) for (let i = 0; i < MODEL.dim; i++) v[i] /= n;
        return v;
      });
    },
  };
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function mkVault(tag: string): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), `minerva-route-${tag}-`));
  cleanups.push(() => fsp.rm(vault, { recursive: true, force: true }));
  return vault;
}

describe('route-through-app (#1524)', () => {
  it('routes proposeNote to the app, files it through the gate, and fires PROPOSALS_CHANGED', async () => {
    const vault = mkVault('propose');
    const ctx = projectContext(vault);
    await graph.initGraph(ctx); // the "app" holds a live graph store

    const events: string[] = [];
    const off = onProposalsChanged((rp) => events.push(rp));
    cleanups.push(off);

    await appServer.registerProject(ctx);
    cleanups.push(() => appServer.unregisterProject(vault));

    const before = appServer._dispatchedCountForTest();
    const engine = createRoutedEngine(ctx);
    const r = await engine.proposeNote({
      relativePath: 'notes/idea.md',
      content: '# Idea\n\nA proposed thought.\n',
      proposedBy: 'mcp:test',
    });

    // Routed, not fallen back to direct.
    expect(appServer._dispatchedCountForTest()).toBe(before + 1);
    expect(r.ok).toBe(true);
    const data = (r as { ok: true; data: Record<string, unknown> }).data;
    expect(data.status).toBe('pending');
    expect(data.proposedBy).toBe('mcp:test');
    expect(data.proposalUri).toBeTruthy();
    // The app-side propose emitted the change event for this thoughtbase.
    expect(events).toContain(vault);
    // Pending → the note file is NOT written.
    expect(fs.existsSync(path.join(vault, 'notes', 'idea.md'))).toBe(false);
    // Persisted for the app's review queue.
    const ttl = await fsp.readFile(path.join(vault, '.minerva', 'graph.ttl'), 'utf-8');
    expect(ttl).toContain('Proposal');
    expect(ttl).toMatch(/pending/);
  });

  it('routes semantic to the app while it holds the file-backed DuckDB open (closes #1272)', async () => {
    const vault = mkVault('semantic');
    const ctx = projectContext(vault);
    await fsp.writeFile(path.join(vault, 'green.md'), '# Green\n\nchlorophyll is a green pigment\n', 'utf-8');
    // The "app" opens the file-backed vector store and holds the lock.
    await store.init(ctx, { embedder: fakeEmbedder() });
    await store.indexNote(ctx, 'green.md', 'chlorophyll is a green pigment');
    cleanups.push(() => store.dispose(ctx));

    await appServer.registerProject(ctx);
    cleanups.push(() => appServer.unregisterProject(vault));

    const before = appServer._dispatchedCountForTest();
    // A direct engine would try to open the same DuckDB file → `Conflicting
    // lock`; routing runs the search inside the app that already holds it.
    const engine = createRoutedEngine(ctx, { embedder: fakeEmbedder() });
    const r = await engine.semantic('green pigment');

    expect(appServer._dispatchedCountForTest()).toBe(before + 1);
    expect(r.ok).toBe(true);
    const data = (r as { ok: true; data: { hits: Array<{ ref: string }> } }).data;
    expect(data.hits.map((h) => h.ref)).toContain('green.md');
  });

  it('falls back to the direct path when no app is advertised', async () => {
    const vault = mkVault('noapp');
    const ctx = projectContext(vault);

    const before = appServer._dispatchedCountForTest();
    const engine = createRoutedEngine(ctx);
    const r = await engine.proposeNote({
      relativePath: 'a.md',
      content: '# A\n\nbody a\n',
      proposedBy: 'cli',
    });

    // No advert → no request reached any server.
    expect(appServer._dispatchedCountForTest()).toBe(before);
    expect(r.ok).toBe(true);
    // The direct path still filed the proposal.
    const ttl = await fsp.readFile(path.join(vault, '.minerva', 'graph.ttl'), 'utf-8');
    expect(ttl).toContain('Proposed note: a.md');
  });

  it('ignores a stale advert whose pid is dead and falls back to direct', async () => {
    const vault = mkVault('stale');
    const ctx = projectContext(vault);
    await fsp.mkdir(path.join(vault, '.minerva'), { recursive: true });
    // A dead pid (max int32-ish, not a live process) simulates a crash that left
    // the advert behind. Port is bogus — it must never be dialed.
    await fsp.writeFile(
      path.join(vault, '.minerva', RUNTIME_FILE),
      JSON.stringify({ pid: 2147483646, port: 1, token: 'stale', startedAt: '2020-01-01T00:00:00Z' }),
      'utf-8',
    );

    const before = appServer._dispatchedCountForTest();
    const engine = createRoutedEngine(ctx);
    const r = await engine.proposeNote({
      relativePath: 'b.md',
      content: '# B\n\nbody b\n',
      proposedBy: 'cli',
    });

    expect(appServer._dispatchedCountForTest()).toBe(before);
    expect(r.ok).toBe(true);
    const ttl = await fsp.readFile(path.join(vault, '.minerva', 'graph.ttl'), 'utf-8');
    expect(ttl).toContain('Proposed note: b.md');
  });

  it('unregisterProject removes the advert so later clients go direct', async () => {
    const vault = mkVault('unreg');
    const ctx = projectContext(vault);
    await graph.initGraph(ctx);
    await appServer.registerProject(ctx);
    expect(fs.existsSync(path.join(vault, '.minerva', RUNTIME_FILE))).toBe(true);

    await appServer.unregisterProject(vault);
    expect(fs.existsSync(path.join(vault, '.minerva', RUNTIME_FILE))).toBe(false);

    const before = appServer._dispatchedCountForTest();
    const engine = createRoutedEngine(ctx);
    const r = await engine.proposeNote({ relativePath: 'c.md', content: '# C\n\nc\n', proposedBy: 'cli' });
    expect(appServer._dispatchedCountForTest()).toBe(before);
    expect(r.ok).toBe(true);
  });
});
