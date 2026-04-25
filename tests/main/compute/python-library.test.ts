/**
 * End-to-end tests for the bundled `minerva` Python library (#242).
 *
 * These spawn a real kernel against a real project, run a real
 * `import minerva` cell, and assert the response shape. The kernel
 * connects back to the main-side RPC server over a Unix socket, so
 * a green run here exercises:
 *   - the kernel adapter spawns with PYTHONPATH + MINERVA_IPC_SOCKET set
 *   - the RPC server listens, dispatches, replies
 *   - the Python package's blocking socket client + JSON framing
 *   - the exception-class translation (server error -> NotFoundError)
 *
 * Skips when `python3` isn't on PATH so CI without Python doesn't fail.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runPython, shutdownAllKernels, stopKernel } from '../../../src/main/compute/python-kernel';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { initSearch, indexNote as searchIndex } from '../../../src/main/search/index';
import { initTablesDb } from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';

function pythonAvailable(): boolean {
  const bin = process.env.MINERVA_PYTHON ?? 'python3';
  try {
    execSync(`${bin} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const skipIfNoPython = pythonAvailable() ? describe : describe.skip;

skipIfNoPython('minerva.* Python library (#242)', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pylib-test-'));
  });

  afterAll(async () => {
    await shutdownAllKernels();
    await fsp.rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Each test gets a fresh project state — but reuse the kernel.
    // Re-initing graph/search/tables wipes the in-memory store.
    const ctx = projectContext(root);
    await initGraph(ctx);
    await initSearch(ctx);
    await initTablesDb(ctx);
  });

  afterEach(async () => {
    // Wipe Python namespace state too so a leftover `import minerva`
    // import-cache + sticky `minerva._current_notebook` doesn't leak
    // between tests. stopKernel + the next runPython respawn is the
    // simplest reset.
    await stopKernel(root);
  });

  it('import minerva succeeds with zero config; ctx() carries the project root', async () => {
    const r = await runPython(root, 'a.md', `
import minerva, os
ctx = minerva.ctx()
{'project_root': ctx['project_root'], 'notebook_path': ctx['notebook_path']}
`);
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'json') return;
    const value = r.output.value as { project_root: string; notebook_path: string };
    expect(value.project_root).toBe(root);
    expect(value.notebook_path).toBe('a.md');
  });

  it('minerva.notes.read on a missing file raises minerva.NotFoundError', async () => {
    const r = await runPython(root, 't.md', `
import minerva
try:
    minerva.notes.read('does-not-exist.md')
    'NO_RAISE'
except minerva.NotFoundError as e:
    'NotFoundError: ' + str(e)
`);
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'json') return;
    expect(String(r.output.value)).toMatch(/^NotFoundError:.*does-not-exist\.md/);
  });

  it('minerva.notes.by_tag round-trips against the graph', async () => {
    const ctx = projectContext(root);
    await indexNote(ctx, 'taggedA.md', '# Tagged A\n#myunique\n');
    await indexNote(ctx, 'taggedB.md', '# Tagged B\nuntagged.\n');

    const r = await runPython(root, 'q.md', `
import minerva
sorted(n['relativePath'] for n in minerva.notes.by_tag('myunique'))
`);
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'json') return;
    expect(r.output.value).toEqual(['taggedA.md']);
  });

  it('minerva.notes.read returns frontmatter + body for an existing note', async () => {
    await fsp.writeFile(
      path.join(root, 'real.md'),
      '---\ntitle: Real Note\ntags: [alpha]\n---\n# Real Note\nHello.\n',
      'utf-8',
    );
    const r = await runPython(root, 'r.md', `
import minerva
note = minerva.notes.read('real.md')
{'title': note['title'], 'tags': note['tags'], 'has_body': 'Hello.' in note['body']}
`);
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'json') return;
    const v = r.output.value as { title: string; tags: string[]; has_body: boolean };
    expect(v.title).toBe('Real Note');
    expect(v.tags).toEqual(['alpha']);
    expect(v.has_body).toBe(true);
  });

  it('minerva.sparql results round-trip; rows match the same query through queryGraph', async () => {
    const ctx = projectContext(root);
    await indexNote(ctx, 'sparkle.md', '# Sparkle\n');

    // Skip this test if pandas isn't installed in the dev env. Use
    // importlib.util.find_spec — a try/import block is a statement,
    // not an expression, so it can't be the last value in a cell.
    const probe = await runPython(root, 'probe.md', `
import importlib.util
importlib.util.find_spec('pandas') is not None
`);
    if (probe.ok && probe.output.type === 'json' && probe.output.value === false) {
      // pandas not available — assert minerva.sparql raises a clear ImportError.
      const r = await runPython(root, 'no-pd.md', `
import minerva
try:
    minerva.sparql('SELECT * WHERE { ?s ?p ?o } LIMIT 1')
    'NO_RAISE'
except ImportError as e:
    'ImportError: ' + str(e)[:30]
`);
      expect(r.ok).toBe(true);
      if (!r.ok || r.output.type !== 'json') return;
      expect(String(r.output.value)).toMatch(/^ImportError:/);
      return;
    }

    // pandas is installed; full DataFrame round-trip.
    const r = await runPython(root, 'sp.md', `
import minerva
df = minerva.sparql('SELECT ?t WHERE { ?n minerva:relativePath "sparkle.md" ; dc:title ?t . }')
{'rows': len(df), 'first_t': df.iloc[0]['t'] if len(df) else None}
`);
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'json') return;
    const v = r.output.value as { rows: number; first_t: string };
    expect(v.rows).toBe(1);
    expect(v.first_t).toBe('Sparkle');
  });

  it('minerva.sparql parse error surfaces as minerva.QueryError', async () => {
    const r = await runPython(root, 'qe.md', `
import minerva
try:
    minerva.sparql('SELECT WHERE {')
    'NO_RAISE'
except minerva.QueryError as e:
    'QueryError: ' + str(e)[:30]
except ImportError as e:
    # pandas not installed — sparql aborts with ImportError before sending.
    'ImportError'
`);
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'json') return;
    const out = String(r.output.value);
    // Either the QueryError fires (pandas installed) or ImportError
    // does (pandas not installed) — both prove the library is wired
    // correctly; we just want to NOT see 'NO_RAISE'.
    expect(out).not.toBe('NO_RAISE');
  });
});
