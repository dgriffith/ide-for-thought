/**
 * A project open reads each note once, not twice (#2216).
 *
 * `indexAllNotes` is deliberately two passes: the alias pre-pass has to finish
 * before any link resolves, or a note indexed early would resolve `[[alias]]`
 * against an incomplete map (#469). But both passes walk exactly the same
 * files, so every note was read from disk twice per project open — measured at
 * 2,000 notes of ~2.2KB, 120ms per pass.
 *
 * The pre-pass now hands its bytes to the main pass, under a byte budget so a
 * corpus large enough for the saving to matter cannot also be large enough for
 * the cache to hurt. Past the cap the pre-pass stops retaining and the main
 * pass re-reads, which is exactly the old behaviour.
 *
 * Gates are READ COUNTS (#2229's scope note) — exact, where a boot timing on a
 * shared machine is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { initGraph, indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { deleteState } from '../../../src/main/graph/state';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const PREFIX = 'minerva-single-read-';

/** Write `noteCount` cross-linked notes into the fixture's project. */
function seed(ctx: ProjectContext, noteCount: number, bodyPadding = ''): ProjectContext {
  const root = ctx.rootPath;
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  for (let i = 0; i < noteCount; i++) {
    fs.writeFileSync(
      path.join(root, 'notes', `n${i}.md`),
      `---\ntitle: Note ${i}\naliases: [alias-${i}]\n---\n\n# Note ${i}\n\n[[n${(i + 1) % noteCount}]]\n${bodyPadding}`,
    );
  }
  return ctx;
}

/** Count `readFile` calls of NOTES (the walk), ignoring .minerva bookkeeping. */
async function countNoteReads(fn: () => Promise<unknown>): Promise<number> {
  let n = 0;
  const real = fsp.readFile;
  const spy = vi.spyOn(fsp, 'readFile').mockImplementation(((...args: unknown[]) => {
    const p = String(args[0]);
    if (p.includes(`${path.sep}notes${path.sep}`) && p.endsWith('.md')) n += 1;
    return (real as unknown as (...a: unknown[]) => unknown)(...args);
  }) as never);
  try {
    await fn();
    return n;
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => { vi.restoreAllMocks(); });

describe('the two passes share one read (#2216)', () => {
  const project = useGraphProject(PREFIX);
  it('20 notes cost 20 reads, not 40', async () => {
    const ctx = seed(project.ctx, 20);
    await initGraph(ctx, { rebuildFollows: true });
    const reads = await countNoteReads(() => indexAllNotes(ctx));
    expect(reads, 'every note was read twice').toBe(20);
  });

  it('and every note is still indexed', async () => {
    // The count gate above is satisfied by a pass that indexes nothing. The
    // notes must actually be in the graph, from the reused bytes.
    const ctx = seed(project.ctx, 20);
    await initGraph(ctx, { rebuildFollows: true });
    await indexAllNotes(ctx);
    const notes = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expect(notes.results.length).toBe(20);
  });

  it('aliases from the pre-pass still resolve links in the main pass', async () => {
    // The reason the two passes exist at all (#469). Reusing pass 1's bytes
    // must not disturb the ordering guarantee they buy: every note links to
    // its neighbour, so a complete alias/path map is required for all 20 links
    // to land.
    const ctx = seed(project.ctx, 20);
    await initGraph(ctx, { rebuildFollows: true });
    await indexAllNotes(ctx);
    // A plain `[[target]]` is the default link type, whose predicate is
    // `minerva:references` (`shared/link-types.ts`) — not `linksTo`, which
    // does not exist and made the first version of this test assert zero
    // against zero.
    const links = await queryGraph(ctx, 'SELECT ?s ?t WHERE { ?s minerva:references ?t }');
    expect(links.results.length, 'links went unresolved after the read was shared').toBe(20);
  });

  it('a re-run from scratch still costs one read per note', async () => {
    // The cache is per-rebuild and cleared on the way out; a second rebuild
    // must neither reuse stale bytes nor pay double.
    const ctx = seed(project.ctx, 15);
    await initGraph(ctx, { rebuildFollows: true });
    await indexAllNotes(ctx);
    const reads = await countNoteReads(() => indexAllNotes(ctx));
    expect(reads).toBe(15);
  });

  it('picks up an edit made between rebuilds', async () => {
    // The staleness question, asked at the boundary that matters. Within one
    // rebuild the pre-pass's bytes are authoritative by design; ACROSS
    // rebuilds nothing may be retained.
    const ctx = seed(project.ctx, 5);
    await initGraph(ctx, { rebuildFollows: true });
    await indexAllNotes(ctx);

    fs.writeFileSync(
      path.join(ctx.rootPath, 'notes', 'n0.md'),
      '---\ntitle: Renamed After Boot\n---\n\n# Renamed After Boot\n',
    );
    await indexAllNotes(ctx);

    const titles = await queryGraph(ctx, 'SELECT ?t WHERE { ?s dc:title ?t }');
    expect(
      titles.results.some((r) => r.t === 'Renamed After Boot'),
      'a rebuild served the previous rebuild\'s bytes',
    ).toBe(true);
  });
});

describe('the budget degrades to re-reading, not to memory pressure', () => {
  const project = useGraphProject(PREFIX);
  it('falls back to a second read once the cap is exceeded', async () => {
    // 40 notes padded past the 64MB cap between them. The point is not the
    // exact count but that exceeding the budget is SAFE: it costs reads, and
    // the project still opens correctly.
    const padding = 'x'.repeat(2 * 1024 * 1024); // 2MB each
    const ctx = seed(project.ctx, 40, padding);
    await initGraph(ctx, { rebuildFollows: true });

    const reads = await countNoteReads(() => indexAllNotes(ctx));
    expect(reads, 'nothing was cached at all').toBeGreaterThan(40);
    expect(reads, 'the budget stopped applying').toBeLessThanOrEqual(80);

    const notes = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expect(notes.results.length, 'exceeding the budget lost notes').toBe(40);
  }, 120_000);
});

describe('the snapshot parse and the shared read compose', () => {
  const project = useGraphProject(PREFIX);
  it('a full open reads each note once and parses no snapshot', async () => {
    // Both #2216 changes on the same path, asserted together — they touch the
    // same project-open sequence and a fix for one must not reinstate the
    // other's cost.
    const ctx = seed(project.ctx, 12);
    await initGraph(ctx, { rebuildFollows: true });
    await indexAllNotes(ctx);

    deleteState(ctx);
    await initGraph(ctx, { rebuildFollows: true });
    const beforeRebuild = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expect(beforeRebuild.results.length, 'the snapshot was parsed for nothing').toBe(0);

    const reads = await countNoteReads(() => indexAllNotes(ctx));
    expect(reads).toBe(12);
    const after = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expect(after.results.length).toBe(12);
  });
});
