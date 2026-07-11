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
});
