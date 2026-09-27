/**
 * The five maintenance commands, run for real against a temp project (#2407).
 *
 * #2233 moved these out of `menu.ts` click handlers into
 * `src/main/maintenance-commands.ts` so the menu and the IPC channels share one
 * implementation. But both registrar tests (`register-maintenance`,
 * `register-graph`) mock that module, so until this file nothing ever executed
 * it — 0% coverage on the one implementation both surfaces depend on.
 *
 * Nothing here is mocked except what is genuinely outside the process: the
 * embedding model is swapped for a deterministic hashing embedder (the WASM
 * model is a runtime download), and the live-kernel cases need a real
 * `python3` and skip without one. Graph, search, DuckDB tables, the vector
 * store and the kernel manager are the real modules, so every assertion is an
 * observable effect — a triple, a search hit, a table, a vector row, a file —
 * rather than "function X was called".
 *
 * The kernel manager's call contract (and the failure frames that need a
 * kernel that *throws*, which a real one can't be made to do on demand) lives
 * in the sibling `maintenance-commands-kernel.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as $rdf from 'rdflib';
import {
  rebuildAllIndexes,
  rebuildSemanticIndex,
  interruptCell,
  restartKernel,
  exportKnowledgeGraph,
  interruptReason,
} from '../../src/main/maintenance-commands';
import * as graph from '../../src/main/graph/index';
import * as search from '../../src/main/search/index';
import * as tables from '../../src/main/sources/tables';
import * as vectors from '../../src/main/embeddings/vector-store';
import type { ChunkEmbedder } from '../../src/main/embeddings/vector-store';
import { MODEL } from '../../src/main/embeddings/embedder';
import { abortBackfill } from '../../src/main/embeddings/backfill';
import {
  runPython,
  activeKernels,
  stopKernel,
} from '../../src/main/compute/python-kernel';
import { projectContext } from '../../src/main/project-context-types';
import type { MaintenanceProgress, MaintenanceFinished } from '../../src/shared/maintenance';
import { useGraphProject, useTempDir } from '../helpers/temp-project';

// ── helpers ─────────────────────────────────────────────────────────────────

function collector() {
  const frames: MaintenanceProgress[] = [];
  return { frames, emit: (p: MaintenanceProgress) => { frames.push(p); } };
}

function terminal(frames: MaintenanceProgress[]): MaintenanceFinished {
  const done = frames.filter((f): f is MaintenanceFinished => !f.running);
  // The renderer clears its overlay on the terminal frame and nothing else.
  expect(done).toHaveLength(1);
  expect(frames.at(-1)).toBe(done[0]);
  return done[0]!;
}

async function write(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf-8');
}

/** Relative paths of every note the graph knows about. */
async function graphNotePaths(root: string): Promise<string[]> {
  const { results } = await graph.queryGraphRows(projectContext(root), `
    SELECT ?p WHERE { ?n a minerva:Note ; minerva:relativePath ?p . } ORDER BY ?p
  `);
  return (results as Array<{ p: string }>).map((r) => r.p);
}

/** A deterministic bag-of-words embedder — the real model is a runtime download. */
function hashingEmbedder(): ChunkEmbedder {
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

function pythonAvailable(): boolean {
  try {
    execSync(`${process.env.MINERVA_PYTHON ?? 'python3'} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

// ── rebuildAllIndexes ───────────────────────────────────────────────────────

describe('rebuildAllIndexes', () => {
  const project = useGraphProject('minerva-maint-rebuild-');

  beforeEach(async () => {
    await tables.initTablesDb(project.ctx);
  });
  afterEach(() => {
    tables.disposeProject(project.ctx);
    search.disposeProject(project.ctx);
    graph.disposeProject(project.ctx);
  });

  it('indexes notes written to disk after the graph was opened', async () => {
    await write(project.root, 'alpha.md', '# Alpha\n\nFirst note.');
    await write(project.root, 'deep/beta.md', '# Beta\n\nSecond note.');

    await rebuildAllIndexes(project.root, collector().emit);

    expect(await graphNotePaths(project.root)).toEqual(['alpha.md', 'deep/beta.md']);
  });

  it('drops a note deleted on disk since the last index', async () => {
    await write(project.root, 'keep.md', '# Keep');
    await write(project.root, 'gone.md', '# Gone');
    await rebuildAllIndexes(project.root, collector().emit);
    await fsp.rm(path.join(project.root, 'gone.md'));

    await rebuildAllIndexes(project.root, collector().emit);

    expect(await graphNotePaths(project.root)).toEqual(['keep.md']);
  });

  it('rebuilds the full-text search index from disk', async () => {
    await write(project.root, 'zebra.md', '# Zebra\n\nStripes are quixotically distinctive.');

    await rebuildAllIndexes(project.root, collector().emit);

    const hits = await search.search(project.ctx, 'quixotically');
    expect(hits.map((h) => h.relativePath)).toEqual(['zebra.md']);
  });

  it('persists the rebuilt search index to .minerva/search-index.json', async () => {
    await write(project.root, 'a.md', '# A');

    await rebuildAllIndexes(project.root, collector().emit);

    expect(fs.existsSync(path.join(project.root, '.minerva', 'search-index.json'))).toBe(true);
  });

  it('registers CSV files and captioned note tables as SQL tables', async () => {
    await write(project.root, 'stations.csv', 'id,name\n1,Alpha\n2,Beta\n');
    await write(project.root, 'report.md', 'Table: findings\n| metric | value |\n|---|---|\n| n | 5 |');

    await rebuildAllIndexes(project.root, collector().emit);

    const names = (await tables.listTables(project.ctx)).map((t) => `${t.name}:${t.source}`).sort();
    expect(names).toEqual(['findings:note', 'stations:csv']);
  });

  it('keeps CSV-schema triples — CSVs register AFTER the store reset, not into the discarded one', async () => {
    await write(project.root, 'stations.csv', 'id,name\n1,Alpha\n');

    await rebuildAllIndexes(project.root, collector().emit);

    const { results } = await graph.queryGraphRows(project.ctx, `
      SELECT ?col WHERE {
        ?table minerva:fromFile ?file .
        ?file minerva:relativePath "stations.csv" .
        ?table csvw:tableSchema ?s . ?s csvw:column ?c . ?c csvw:name ?col .
      } ORDER BY ?col
    `);
    expect((results as Array<{ col: string }>).map((r) => r.col)).toEqual(['id', 'name']);
  });

  it('lets a CSV win a table name shared with a note table (#1358 ordering)', async () => {
    await write(project.root, 'sales.csv', 'x,y\n1,2\n');
    await write(project.root, 'note.md', 'Table: sales\n| a | b |\n|---|---|\n| 9 | 9 |');

    await rebuildAllIndexes(project.root, collector().emit);

    const sales = (await tables.listTables(project.ctx)).filter((t) => t.name === 'sales');
    expect(sales.map((t) => t.source)).toEqual(['csv']);
  });

  it('resolves true on success', async () => {
    await write(project.root, 'a.md', '# A');

    await expect(rebuildAllIndexes(project.root, collector().emit)).resolves.toBe(true);
  });

  it('reports a blocking run and a summary counting the notes indexed', async () => {
    await write(project.root, 'a.md', '# A');
    await write(project.root, 'b.md', '# B');
    const { frames, emit } = collector();

    await rebuildAllIndexes(project.root, emit);

    expect(frames[0]).toEqual({
      task: 'rebuildIndexes', running: true, style: 'blocking', label: 'Rebuilding indexes',
    });
    expect(terminal(frames).outcome).toEqual({ ok: true, summary: 'Rebuilt indexes — 2 notes' });
  });

  it('publishes determinate progress from the graph walk', async () => {
    await write(project.root, 'a.md', '# A');
    await write(project.root, 'b.md', '# B');
    const { frames, emit } = collector();

    await rebuildAllIndexes(project.root, emit);

    const progress = frames.filter((f) => f.running && f.total !== undefined);
    expect(progress.at(-1)).toMatchObject({ done: 2, total: 2 });
  });

  describe('when a subsystem fails', () => {
    // A directory where the search index file should be makes MiniSearch's
    // save throw EISDIR — a real IO failure, not a mocked one.
    beforeEach(async () => {
      await fsp.mkdir(path.join(project.root, '.minerva', 'search-index.json'), { recursive: true });
      await write(project.root, 'a.md', '# A');
    });

    it('resolves false so the caller does not refresh a half-built table list', async () => {
      await expect(rebuildAllIndexes(project.root, collector().emit)).resolves.toBe(false);
    });

    it('reports the failure as a terminal frame instead of throwing', async () => {
      const { frames, emit } = collector();

      await rebuildAllIndexes(project.root, emit);

      const outcome = terminal(frames).outcome;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toMatch(/EISDIR|directory/i);
    });
  });
});

// ── rebuildSemanticIndex ────────────────────────────────────────────────────

describe('rebuildSemanticIndex', () => {
  const dir = useTempDir('minerva-maint-semantic-');
  const ctx = () => projectContext(dir.root);

  afterEach(async () => {
    abortBackfill(dir.root);
    await vectors.dispose(ctx());
  });

  async function enableVectors(): Promise<void> {
    await vectors.init(ctx(), {
      dbPath: path.join(dir.root, '.minerva', 'vectors.duckdb'),
      embedder: hashingEmbedder(),
    });
  }

  it('embeds every note on disk', async () => {
    await enableVectors();
    await write(dir.root, 'a.md', '# A\nalpha');
    await write(dir.root, 'sub/b.md', '# B\nbeta');

    await rebuildSemanticIndex(dir.root, collector().emit, () => {});

    expect([...await vectors.embeddedNotePaths(ctx())].sort()).toEqual(['a.md', 'sub/b.md']);
  });

  it('forces a re-embed: rows for notes no longer on disk are cleared', async () => {
    await enableVectors();
    await vectors.indexNote(ctx(), 'deleted-long-ago.md', '# Old\nstale vector');
    await write(dir.root, 'a.md', '# A\nalpha');

    await rebuildSemanticIndex(dir.root, collector().emit, () => {});

    expect([...await vectors.embeddedNotePaths(ctx())]).toEqual(['a.md']);
  });

  it("forces a re-embed: an already-embedded note's stale vectors are replaced from current content", async () => {
    await enableVectors();
    await write(dir.root, 'a.md', '# A\nfresh aardvark content');
    // A stale row under the same path — a non-forced backfill would skip it.
    await vectors.indexNote(ctx(), 'a.md', '# A\nstale zeppelin content');

    await rebuildSemanticIndex(dir.root, collector().emit, () => {});

    const chunks = await vectors.searchRelated(ctx(), 'content', { limit: 50 });
    expect(chunks.map((h) => h.chunkText).join('\n')).not.toContain('zeppelin');
  });

  it('forwards backfill progress, ending with a running:false tick', async () => {
    await enableVectors();
    await write(dir.root, 'a.md', '# A');
    await write(dir.root, 'b.md', '# B');
    const ticks: Array<{ done: number; total: number; running: boolean }> = [];

    await rebuildSemanticIndex(dir.root, collector().emit, (p) => ticks.push({ ...p }));

    expect(ticks.some((t) => t.running && t.done === 2 && t.total === 2)).toBe(true);
    expect(ticks.at(-1)).toEqual({ done: 0, total: 0, running: false });
  });

  it('runs in the background style — embedding never covers the UI', async () => {
    await enableVectors();
    const { frames, emit } = collector();

    await rebuildSemanticIndex(dir.root, emit, () => {});

    expect(frames[0]).toEqual({
      task: 'rebuildSemanticIndex', running: true, style: 'background', label: 'Rebuilding semantic index',
    });
  });

  it('summarizes with the number of notes actually embedded', async () => {
    await enableVectors();
    await write(dir.root, 'a.md', '# A');
    await write(dir.root, 'b.md', '# B');
    await write(dir.root, 'c.md', '# C');
    const { frames, emit } = collector();

    await rebuildSemanticIndex(dir.root, emit, () => {});

    expect(terminal(frames).outcome).toEqual({
      ok: true, summary: 'Rebuilt semantic index — 3 notes embedded',
    });
  });

  it('is a clean no-op when the vector store is not enabled for the project', async () => {
    await write(dir.root, 'a.md', '# A');
    const { frames, emit } = collector();

    await rebuildSemanticIndex(dir.root, emit, () => {});

    expect(terminal(frames).outcome).toEqual({
      ok: true, summary: 'Rebuilt semantic index — 0 notes embedded',
    });
  });
});

// ── interruptCell / restartKernel, no kernel running ────────────────────────

describe('interruptCell with no kernel running', () => {
  const dir = useTempDir('minerva-maint-nokernel-');

  it('says there was nothing to interrupt rather than claiming success (#1814)', async () => {
    const { frames, emit } = collector();

    await interruptCell(dir.root, emit);

    expect(terminal(frames).outcome).toEqual({
      ok: true, summary: 'No Python kernel is running — nothing to interrupt',
    });
  });

  it('runs in the background style', async () => {
    const { frames, emit } = collector();

    await interruptCell(dir.root, emit);

    expect(frames[0]).toEqual({
      task: 'interruptCell', running: true, style: 'background', label: 'Interrupting cell',
    });
  });

  it('does not spawn a kernel as a side effect', async () => {
    await interruptCell(dir.root, collector().emit);

    expect(activeKernels()).not.toContain(dir.root);
  });
});

describe('restartKernel with no kernel running', () => {
  const dir = useTempDir('minerva-maint-norestart-');

  it('completes and reports the restart', async () => {
    const { frames, emit } = collector();

    await restartKernel(dir.root, emit);

    expect(terminal(frames).outcome).toEqual({ ok: true, summary: 'Python kernel restarted' });
  });

  it('runs in the blocking style — cells must not run against a kernel mid-restart', async () => {
    const { frames, emit } = collector();

    await restartKernel(dir.root, emit);

    expect(frames[0]).toEqual({
      task: 'restartKernel', running: true, style: 'blocking', label: 'Restarting Python kernel',
    });
  });

  it('does not spawn a kernel as a side effect', async () => {
    await restartKernel(dir.root, collector().emit);

    expect(activeKernels()).not.toContain(dir.root);
  });
});

// ── interruptCell / restartKernel against a live kernel ─────────────────────

const describeIfPython = pythonAvailable() ? describe : describe.skip;
const itIfPosix = process.platform === 'win32' ? it.skip : it;

describeIfPython('against a live Python kernel', () => {
  const dir = useTempDir('minerva-maint-kernel-');

  afterEach(async () => { await stopKernel(dir.root); });
  afterAll(async () => { await stopKernel(dir.root); });

  it('restartKernel tears the running kernel down', async () => {
    await runPython(dir.root, 'nb.md', '1');
    expect(activeKernels()).toContain(dir.root);

    await restartKernel(dir.root, collector().emit);

    expect(activeKernels()).not.toContain(dir.root);
  });

  it('restartKernel wipes notebook namespaces — the next cell sees a fresh kernel', async () => {
    await runPython(dir.root, 'nb.md', 'kept = 7');

    await restartKernel(dir.root, collector().emit);

    const after = await runPython(dir.root, 'nb.md', 'kept');
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toMatch(/NameError/);
  });

  itIfPosix('interruptCell stops a running cell with KeyboardInterrupt', async () => {
    await runPython(dir.root, 'nb.md', '1');
    const long = runPython(dir.root, 'nb.md', 'import time; time.sleep(30)');
    await new Promise((r) => setTimeout(r, 200));
    const { frames, emit } = collector();

    await interruptCell(dir.root, emit);

    expect(terminal(frames).outcome).toEqual({ ok: true, summary: 'Interrupted the running cell' });
    const r = await long;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/KeyboardInterrupt/);
  });

  it('interruptCell explains that Windows cannot interrupt, instead of pretending it did', async () => {
    await runPython(dir.root, 'nb.md', '1');
    const real = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const { frames, emit } = collector();
    try {
      await interruptCell(dir.root, emit);
    } finally {
      Object.defineProperty(process, 'platform', real);
    }

    expect(terminal(frames).outcome).toEqual({
      ok: true, summary: 'Interrupting a cell isn\'t supported on Windows',
    });
  });
});

// ── interruptReason ─────────────────────────────────────────────────────────

describe('interruptReason', () => {
  it.each([
    ['no-kernel', 'No Python kernel is running — nothing to interrupt'],
    ['unsupported-platform', 'Interrupting a cell isn\'t supported on Windows'],
    ['signal-failed', 'Couldn\'t interrupt the running cell'],
  ] as const)('%s → %s', (reason, message) => {
    expect(interruptReason(reason)).toBe(message);
  });
});

// ── exportKnowledgeGraph ────────────────────────────────────────────────────

const RDF_TYPE = $rdf.sym('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const OWL_CLASS = $rdf.sym('http://www.w3.org/2002/07/owl#Class');
const THOUGHT_CLAIM = $rdf.sym('https://minerva.dev/ontology/thought#Claim');
const MINERVA_NOTE = $rdf.sym('https://minerva.dev/ontology#Note');
const MINERVA_REL_PATH = $rdf.sym('https://minerva.dev/ontology#relativePath');

function parseTurtle(file: string): $rdf.IndexedFormula {
  const kb = $rdf.graph();
  $rdf.parse(fs.readFileSync(file, 'utf-8'), kb, 'urn:x-test:', 'text/turtle');
  return kb;
}

describe('exportKnowledgeGraph', () => {
  const project = useGraphProject('minerva-maint-export-');
  const out = () => path.join(project.root, 'exports', 'graph-export.ttl');

  beforeEach(async () => {
    await fsp.mkdir(path.dirname(out()), { recursive: true });
    await write(project.root, 'notes/idea.md', '---\ntitle: An Idea\n---\n\n# An Idea\n');
    await graph.indexAllNotes(project.ctx);
  });
  afterEach(() => { graph.disposeProject(project.ctx); });

  it('writes a Turtle file at the chosen path', async () => {
    await exportKnowledgeGraph(project.root, out());

    expect(fs.existsSync(out())).toBe(true);
  });

  it('writes Turtle that parses', async () => {
    await exportKnowledgeGraph(project.root, out());

    expect(parseTurtle(out()).statements.length).toBeGreaterThan(0);
  });

  it("contains the user's notes", async () => {
    await exportKnowledgeGraph(project.root, out());

    const kb = parseTurtle(out());
    expect(kb.statementsMatching(null, MINERVA_REL_PATH, $rdf.literal('notes/idea.md'))).toHaveLength(1);
  });

  it('includes the thought ontology — the menu and the channel export the same self-contained file (#2233)', async () => {
    await exportKnowledgeGraph(project.root, out());

    expect(parseTurtle(out()).holds(THOUGHT_CLAIM, RDF_TYPE, OWL_CLASS)).toBe(true);
  });

  it('includes the minerva ontology', async () => {
    await exportKnowledgeGraph(project.root, out());

    expect(parseTurtle(out()).holds(MINERVA_NOTE, RDF_TYPE, OWL_CLASS)).toBe(true);
  });

  it('is NOT a copy of .minerva/graph.ttl, which deliberately omits the ontology (#2233 parity)', async () => {
    await exportKnowledgeGraph(project.root, out());

    // The old channel copied graph.ttl; the menu serialized the live store.
    // graph.ttl is persisted as a side effect of export, so both exist now.
    const persisted = parseTurtle(path.join(project.root, '.minerva', 'graph.ttl'));
    expect(persisted.holds(THOUGHT_CLAIM, RDF_TYPE, OWL_CLASS)).toBe(false);
    expect(parseTurtle(out()).holds(THOUGHT_CLAIM, RDF_TYPE, OWL_CLASS)).toBe(true);
  });

  it('persists the graph first, so .minerva/graph.ttl matches what was exported', async () => {
    await exportKnowledgeGraph(project.root, out());

    const persisted = parseTurtle(path.join(project.root, '.minerva', 'graph.ttl'));
    expect(persisted.statementsMatching(null, MINERVA_REL_PATH, $rdf.literal('notes/idea.md'))).toHaveLength(1);
  });

  it('overwrites an existing file at the destination', async () => {
    await fsp.writeFile(out(), 'not turtle at all', 'utf-8');

    await exportKnowledgeGraph(project.root, out());

    expect(fs.readFileSync(out(), 'utf-8')).not.toContain('not turtle at all');
  });

  describe('errors', () => {
    it('rejects when the destination directory does not exist', async () => {
      const missing = path.join(project.root, 'no-such-dir', 'g.ttl');

      await expect(exportKnowledgeGraph(project.root, missing)).rejects.toThrow(/ENOENT/);
    });

    (RUNNING_AS_ROOT || process.platform === 'win32' ? it.skip : it)(
      'rejects when the destination is not writable',
      async () => {
        const locked = path.join(project.root, 'locked');
        await fsp.mkdir(locked);
        await fsp.chmod(locked, 0o500);
        try {
          await expect(exportKnowledgeGraph(project.root, path.join(locked, 'g.ttl')))
            .rejects.toThrow(/EACCES|EPERM/);
        } finally {
          await fsp.chmod(locked, 0o700);
        }
      },
    );

    it('rejects when the destination is a directory', async () => {
      await expect(exportKnowledgeGraph(project.root, path.dirname(out()))).rejects.toThrow(/EISDIR/);
    });
  });
});

describe('exportKnowledgeGraph with no graph loaded for the project', () => {
  const dir = useTempDir('minerva-maint-export-nograph-');

  it('rejects rather than silently writing nothing (CLAUDE.md IPC rule 2)', async () => {
    await expect(exportKnowledgeGraph(dir.root, path.join(dir.root, 'g.ttl')))
      .rejects.toThrow(/no knowledge graph is loaded/i);
  });

  it('does not create the destination file', async () => {
    const dest = path.join(dir.root, 'g.ttl');

    await exportKnowledgeGraph(dir.root, dest).catch(() => {});

    expect(fs.existsSync(dest)).toBe(false);
  });
});
