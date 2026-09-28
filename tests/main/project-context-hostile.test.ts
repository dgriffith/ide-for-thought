/**
 * Opening a hostile thoughtbase end to end through `acquireProject` (#2372).
 *
 * This is the path a user actually hits: graph init + rebuild, full-text
 * index, tables, conversations, all at once. Before #2372 any one of an
 * in-root dangling symlink, a permission-denied subfolder or a truncated
 * `.minerva/config.json` rejected the whole open.
 *
 * It also pins what happens when an open DOES fail: the registry used to
 * keep the record holding the rejected init promise, so re-opening the same
 * folder after fixing the problem got the old rejection back without
 * re-running init.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  acquireProject,
  releaseProject,
  activeProjects,
  getProjectContext,
} from '../../src/main/project-context';
import { queryGraph } from '../../src/main/graph/index';
import { search } from '../../src/main/search/index';
import {
  useHostileThoughtbase,
  ALL_HOSTILE_FEATURES,
  CONTROL_NOTES,
  OUTSIDE_SECRET,
  posix,
} from '../helpers/hostile-thoughtbase';

const WIN = 4242;

describe('acquireProject on a hostile thoughtbase (#2372)', () => {
  const tb = useHostileThoughtbase(ALL_HOSTILE_FEATURES, 'minerva-open-hostile-');

  afterEach(async () => {
    for (const r of [...activeProjects()]) await releaseProject(r, WIN);
  });

  it('opens, with the control notes in both the graph and the search index', async () => {
    const ctx = await acquireProject(tb.manifest.root, WIN);

    const { results } = await queryGraph(ctx, `SELECT ?p WHERE { ?n minerva:relativePath ?p . }`);
    const graphPaths = (results as Array<{ p: string }>).map((r) => r.p);
    expect(graphPaths).toContain(posix(CONTROL_NOTES.alpha));
    expect((await search(ctx, 'betamarker')).map((r) => r.relativePath)).toEqual([posix(CONTROL_NOTES.beta)]);
  });

  it('exposes nothing from outside the root through either index', async () => {
    const ctx = await acquireProject(tb.manifest.root, WIN);

    const { results } = await queryGraph(ctx, `
      SELECT ?o WHERE { ?s ?p ?o . FILTER(isLiteral(?o) && CONTAINS(STR(?o), "${OUTSIDE_SECRET}")) } LIMIT 1
    `);
    expect(results).toEqual([]);
    expect(await search(ctx, OUTSIDE_SECRET)).toEqual([]);
  });

  it('leaves the corrupt config.json exactly as it found it', async () => {
    const abs = `${tb.manifest.root}/${posix(tb.manifest.paths['corrupt-config']![0])}`;
    const before = fs.readFileSync(abs);

    await acquireProject(tb.manifest.root, WIN);
    await releaseProject(tb.manifest.root, WIN);

    expect(fs.readFileSync(abs).equals(before)).toBe(true);
  });
});

describe('acquireProject does not cache a failed open (#2372)', () => {
  const tb = useHostileThoughtbase([], 'minerva-open-retry-');

  afterEach(async () => {
    fs.chmodSync(tb.manifest.root, 0o755);
    for (const r of [...activeProjects()]) await releaseProject(r, WIN);
  });

  it.skipIf(process.getuid?.() === 0)('re-runs init on the next open once the problem is fixed', async () => {
    fs.chmodSync(tb.manifest.root, 0o000);
    await expect(acquireProject(tb.manifest.root, WIN)).rejects.toThrow();
    // The failed record is gone, not parked holding the rejection.
    expect(getProjectContext(tb.manifest.root)).toBeNull();

    fs.chmodSync(tb.manifest.root, 0o755);
    const ctx = await acquireProject(tb.manifest.root, WIN);

    expect((await search(ctx, 'alphamarker')).map((r) => r.relativePath)).toEqual([posix(CONTROL_NOTES.alpha)]);
  });
});
