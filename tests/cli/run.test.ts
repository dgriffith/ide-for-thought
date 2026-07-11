/**
 * The headless CLI read surface (#1149, epic #1145 — Substrate).
 *
 * Exercises `runCli` end-to-end against a real temp thoughtbase — the same
 * `ctx`-based core the app uses, proving an external process can query the graph
 * and notes without Electron. Asserts the grounded JSON shape (node IRIs / note
 * paths) and the exit-code contract (0 ok / 1 core error / 2 usage).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runCli, parseArgs } from '../../src/cli/run';
import * as store from '../../src/main/embeddings/vector-store';
import type { ChunkEmbedder } from '../../src/main/embeddings/vector-store';
import { MODEL } from '../../src/main/embeddings/embedder';
import { projectContext } from '../../src/main/project-context-types';

/** Deterministic hashing embedder — no WASM model load. Mirrors the stub the
 *  embeddings suite uses so `semantic` is testable fast. */
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

let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cli-'));
  await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
  await fsp.writeFile(
    path.join(root, 'notes', 'photosynthesis.md'),
    '---\ntitle: Photosynthesis\ntags: [biology, energy]\n---\n\n' +
      'Photosynthesis converts light into chemical energy. See [[chlorophyll]].\n',
    'utf-8',
  );
  await fsp.writeFile(
    path.join(root, 'notes', 'chlorophyll.md'),
    '# Chlorophyll\n\nThe green pigment that absorbs light for photosynthesis.\n',
    'utf-8',
  );
  // A CSV table for the `sql` command (registered under the derived name `plants`).
  await fsp.writeFile(
    path.join(root, 'plants.csv'),
    'name,height_cm\nfern,40\nmoss,3\n',
    'utf-8',
  );
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('pulls out command, positionals, and global flags', () => {
    const a = parseArgs(['search', 'green', 'pigment', '--project', '/x', '--limit', '5']);
    expect(a.command).toBe('search');
    expect(a.positionals).toEqual(['green', 'pigment']);
    expect(a.project).toBe('/x');
    expect(a.limit).toBe(5);
  });

  it('supports --flag=value form and -h', () => {
    const a = parseArgs(['read', 'notes/x.md', '--project=/y']);
    expect(a.project).toBe('/y');
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('leaves dashless SPARQL positionals intact', () => {
    const a = parseArgs(['query', 'SELECT ?s WHERE { ?s ?p ?o }']);
    expect(a.command).toBe('query');
    expect(a.positionals).toEqual(['SELECT ?s WHERE { ?s ?p ?o }']);
  });
});

describe('runCli read commands (#1149)', () => {
  it('query returns grounded SPARQL bindings as JSON (exit 0)', async () => {
    const r = await runCli(
      ['query', 'SELECT ?title WHERE { ?n a minerva:Note ; dc:title ?title } ORDER BY ?title'],
      { cwd: root },
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const out = JSON.parse(r.stdout);
    expect(out.columns).toContain('title');
    const titles = out.results.map((row: Record<string, string>) => row.title);
    expect(titles).toContain('Photosynthesis');
  });

  it('search returns note-path-grounded hits (exit 0)', async () => {
    const r = await runCli(['search', 'pigment'], { cwd: root });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.query).toBe('pigment');
    const paths = out.hits.map((h: { relativePath: string }) => h.relativePath);
    expect(paths).toContain('notes/chlorophyll.md');
  });

  it('search honours --limit', async () => {
    const r = await runCli(['search', 'photosynthesis', '--limit', '1'], { cwd: root });
    const out = JSON.parse(r.stdout);
    expect(out.hits.length).toBeLessThanOrEqual(1);
  });

  it('sql queries CSV tables and serializes DuckDB BigInt counts (exit 0)', async () => {
    const r = await runCli(['sql', 'SELECT COUNT(*) AS n FROM plants'], { cwd: root });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const out = JSON.parse(r.stdout);
    // COUNT(*) comes back as a DuckDB BIGINT — the JSON replacer must turn it into
    // a plain number, not throw.
    expect(out.rows[0].n).toBe(2);
  });

  it('semantic returns embedding-ranked hits via an injected embedder (exit 0)', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cli-sem-'));
    const ctx = projectContext(vault);
    try {
      await fsp.writeFile(path.join(vault, 'green.md'), '# Green\n\nchlorophyll is a green pigment\n', 'utf-8');
      // Populate the store with the fake embedder, then let runCli's init no-op
      // and reuse it (init is idempotent per rootPath).
      await store.init(ctx, { embedder: fakeEmbedder() });
      await store.indexNote(ctx, 'green.md', 'chlorophyll is a green pigment');
      const r = await runCli(['semantic', 'green pigment'], { cwd: vault, embedder: fakeEmbedder() });
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.hits.map((h: { ref: string }) => h.ref)).toContain('green.md');
    } finally {
      await store.dispose(ctx);
      await fsp.rm(vault, { recursive: true, force: true });
    }
  });

  it('semantic on an un-embedded vault returns empty hits with a note, not an error', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cli-noembed-'));
    const ctx = projectContext(vault);
    try {
      await fsp.writeFile(path.join(vault, 'a.md'), '# A\n\nsome text\n', 'utf-8');
      // Pre-init with the fake embedder so no real WASM model loads; store is empty.
      await store.init(ctx, { embedder: fakeEmbedder() });
      const r = await runCli(['semantic', 'anything'], { cwd: vault, embedder: fakeEmbedder() });
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.hits).toEqual([]);
      expect(out.note).toMatch(/embedded/i);
    } finally {
      await store.dispose(ctx);
      await fsp.rm(vault, { recursive: true, force: true });
    }
  });

  it('search works on a fresh vault with no pre-existing .minerva (ENOENT guard)', async () => {
    // A dedicated temp dir so no earlier command created `.minerva/` first —
    // this is the ordering that broke the built bundle before runSearch ensured
    // the dir exists.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cli-fresh-'));
    try {
      await fsp.writeFile(path.join(fresh, 'seed.md'), '# Seed\n\nA lonely note about mitochondria.\n', 'utf-8');
      const r = await runCli(['search', 'mitochondria'], { cwd: fresh });
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
      const out = JSON.parse(r.stdout);
      expect(out.hits.map((h: { relativePath: string }) => h.relativePath)).toContain('seed.md');
    } finally {
      await fsp.rm(fresh, { recursive: true, force: true });
    }
  });

  it('read echoes the path and returns the raw markdown (exit 0)', async () => {
    const r = await runCli(['read', 'notes/chlorophyll.md'], { cwd: root });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.path).toBe('notes/chlorophyll.md');
    expect(out.content).toContain('green pigment');
  });
});

describe('runCli propose-note (#1147 — write through the gate)', () => {
  it('files a pending proposal, stamped, without writing the note file', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cli-propose-'));
    try {
      const r = await runCli(['propose-note', 'notes/idea.md', '--by', 'cli'], {
        cwd: vault,
        stdin: '# Idea\n\nA proposed thought.\n',
      });
      expect(r.code).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.status).toBe('pending');
      expect(out.proposedBy).toBe('cli');
      expect(out.proposalUri).toBeTruthy();
      // Pending → the note is NOT written.
      expect(fs.existsSync(path.join(vault, 'notes', 'idea.md'))).toBe(false);
      // The proposal is persisted for the app's review queue.
      const ttl = await fsp.readFile(path.join(vault, '.minerva', 'graph.ttl'), 'utf-8');
      expect(ttl).toContain('Proposal');
      expect(ttl).toMatch(/pending/);
    } finally {
      await fsp.rm(vault, { recursive: true, force: true });
    }
  });

  it('requires the note body on stdin (exit 2)', async () => {
    const r = await runCli(['propose-note', 'notes/x.md'], { cwd: root, stdin: '' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('stdin');
  });

  it('a second proposal does not clobber the first (persistence safety)', async () => {
    // The core risk of the whole propose path: filing #2 re-loads graph.ttl,
    // so #1 must survive. Guards the initGraph → proposeWrite → persistGraph
    // design against a store-reset regression.
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cli-propose2-'));
    try {
      await runCli(['propose-note', 'a.md'], { cwd: vault, stdin: '# A\n\nbody a\n' });
      await runCli(['propose-note', 'b.md'], { cwd: vault, stdin: '# B\n\nbody b\n' });
      const ttl = await fsp.readFile(path.join(vault, '.minerva', 'graph.ttl'), 'utf-8');
      expect(ttl).toContain('Proposed note: a.md');
      expect(ttl).toContain('Proposed note: b.md');
    } finally {
      await fsp.rm(vault, { recursive: true, force: true });
    }
  });
});

describe('runCli contract', () => {
  it('no command prints help with usage exit code 2', async () => {
    const r = await runCli([], { cwd: root });
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('Usage:');
  });

  it('--help is a clean exit 0', async () => {
    const r = await runCli(['--help'], { cwd: root });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Commands:');
  });

  it('unknown command is a usage error (exit 2)', async () => {
    const r = await runCli(['frobnicate'], { cwd: root });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Unknown command');
  });

  it('a missing project directory is a usage error (exit 2)', async () => {
    const r = await runCli(['search', 'x', '--project', '/no/such/dir/here'], { cwd: root });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Not a directory');
  });

  it('read of a traversal path is refused, not a crash', async () => {
    const r = await runCli(['read', '../../etc/passwd'], { cwd: root });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/Error:/);
  });

  it('a malformed SPARQL query surfaces as a core error (exit 1)', async () => {
    const r = await runCli(['query', 'THIS IS NOT SPARQL'], { cwd: root });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('SPARQL error');
  });

  it('a malformed SQL query surfaces as a core error (exit 1)', async () => {
    const r = await runCli(['sql', 'SELECT * FROM no_such_table'], { cwd: root });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('SQL error');
  });
});
