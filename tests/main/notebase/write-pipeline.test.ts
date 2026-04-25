/**
 * #341 — the 6-step write pipeline used by every server-side note edit.
 * Before extraction, REFACTOR_AUTO_TAG and REFACTOR_AUTO_LINK_APPLY
 * had drifted and skipped step 6 (heading-rename detection); these
 * tests lock down that every step fires through writeAndReindex,
 * regardless of the option set.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { initSearch, search as runSearch } from '../../../src/main/search/index';
import {
  writeAndReindex,
  type WritePipelineHooks,
} from '../../../src/main/notebase/write-pipeline';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-write-pipeline-test-'));
}

function makeHooks(): WritePipelineHooks & {
  marked: string[];
  rewritten: Array<{ rootPath: string; paths: string[] }>;
  headingRenames: Array<{ rootPath: string; candidate: { oldSlug: string; newSlug: string } }>;
} {
  const marked: string[] = [];
  const rewritten: Array<{ rootPath: string; paths: string[] }> = [];
  const headingRenames: Array<{ rootPath: string; candidate: { oldSlug: string; newSlug: string } }> = [];
  return {
    marked,
    rewritten,
    headingRenames,
    markPathHandled: (p) => marked.push(p),
    broadcastRewritten: (rootPath, paths) => rewritten.push({ rootPath, paths }),
    broadcastHeadingRename: (rootPath, c) => headingRenames.push({
      rootPath,
      candidate: { oldSlug: c.oldSlug, newSlug: c.newSlug },
    }),
  };
}

describe('writeAndReindex (#341)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
    await initSearch(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('runs all 6 steps on a fresh write: file is written, indexed in graph + search, broadcasts fire', async () => {
    const hooks = makeHooks();
    await writeAndReindex(root, 'foo.md', '# Foo\nbody.\n', hooks);

    // Step 1: marked.
    expect(hooks.marked).toEqual(['foo.md']);

    // Step 2: file on disk.
    const onDisk = await fsp.readFile(path.join(root, 'foo.md'), 'utf-8');
    expect(onDisk).toBe('# Foo\nbody.\n');

    // Step 3: graph indexed (has dc:title).
    const r = await queryGraph(ctx, `
      SELECT ?t WHERE { ?n minerva:relativePath "foo.md" ; dc:title ?t . }
    `);
    expect((r.results as Array<{ t: string }>)[0].t).toBe('Foo');

    // Step 4: search indexed (full-text query hits).
    const hits = runSearch(ctx, 'body');
    expect(hits.some((h) => h.relativePath === 'foo.md')).toBe(true);

    // Step 6: rewritten broadcast went out for this path.
    expect(hooks.rewritten).toEqual([{ rootPath: root, paths: ['foo.md'] }]);

    // Step 7: no heading-rename for a fresh file (no prior snapshot).
    expect(hooks.headingRenames).toEqual([]);
  });

  it('fires broadcastHeadingRename when an indexed heading is renamed and an inbound link references it', async () => {
    // Prior snapshot of `foo.md` with one heading.
    await indexNote(ctx, 'foo.md', '# Original Heading\n');
    // A second note with a link targeting the heading's anchor.
    await indexNote(ctx, 'links.md', '[[foo#original-heading]]\n');

    const hooks = makeHooks();
    // Now rewrite foo.md with the heading text changed → looks like a rename.
    await writeAndReindex(root, 'foo.md', '# Renamed Heading\n', hooks);

    expect(hooks.headingRenames).toHaveLength(1);
    expect(hooks.headingRenames[0].candidate.oldSlug).toBe('original-heading');
    expect(hooks.headingRenames[0].candidate.newSlug).toBe('renamed-heading');
  });

  it('suppressRewrittenBroadcast: omits the rewritten broadcast (renderer-initiated save shape)', async () => {
    const hooks = makeHooks();
    await writeAndReindex(root, 'foo.md', '# Foo\n', hooks, {
      suppressRewrittenBroadcast: true,
    });
    expect(hooks.rewritten).toEqual([]);
    // Other steps still happen.
    expect(hooks.marked).toEqual(['foo.md']);
    expect(fs.existsSync(path.join(root, 'foo.md'))).toBe(true);
  });

  it('skipPersist: caller batches search.persist after a loop', async () => {
    const hooks = makeHooks();
    // Three writes through the helper, each skipping persist.
    for (const name of ['a.md', 'b.md', 'c.md']) {
      await writeAndReindex(root, name, `# ${name}\n`, hooks, {
        skipPersist: true,
        suppressRewrittenBroadcast: true,
      });
    }
    // All three were marked + indexed; no rewritten broadcasts (suppressed).
    expect(hooks.marked).toEqual(['a.md', 'b.md', 'c.md']);
    expect(hooks.rewritten).toEqual([]);
    // Files all exist.
    for (const name of ['a.md', 'b.md', 'c.md']) {
      expect(fs.existsSync(path.join(root, name))).toBe(true);
    }
  });

  it('returns the headingRenameCandidate so callers that want it (renderer-initiated path) can decide what to do', async () => {
    await indexNote(ctx, 'foo.md', '# Original\n');
    await indexNote(ctx, 'links.md', '[[foo#original]]\n');

    const hooks = makeHooks();
    const result = await writeAndReindex(root, 'foo.md', '# New Title\n', hooks);
    expect(result.headingRenameCandidate?.oldSlug).toBe('original');
    expect(result.headingRenameCandidate?.newSlug).toBe('new-title');
  });
});
