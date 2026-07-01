/**
 * applyPropertyUpdates (#942): the set_properties apply path now routes each
 * per-note frontmatter patch through the approval engine's note_rewrite payload
 * instead of writing directly. Verifies the patch lands on disk AND leaves an
 * approved thought:Proposal (the Trust Principle audit record), while preserving
 * the handler's non-fatal-per-note behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyPropertyUpdates } from '../../../src/main/llm/set-properties';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

let root: string;
let ctx: ProjectContext;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-setprops-'));
  ctx = projectContext(root);
  await initGraph(ctx);
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

async function plant(rel: string, content: string): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf-8');
  await indexNote(ctx, rel, content);
}

async function approvedRewriteCount(): Promise<number> {
  const r = await queryGraph(ctx, `
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    SELECT ?p WHERE {
      ?p a thought:Proposal ;
         thought:operationType "note_rewrite" ;
         thought:proposalStatus thought:approved .
    }`);
  return r.results.length;
}

describe('applyPropertyUpdates (#942)', () => {
  it('applies the patch on disk AND files an approved note_rewrite proposal', async () => {
    await plant('notes/a.md', '# A\n\nBody.\n');
    const { outcomes, rewrittenPaths } = await applyPropertyUpdates(
      root,
      [{ relativePath: 'notes/a.md', properties: { status: 'done' } }],
      'conv-1',
    );

    expect(outcomes[0].changedKeys).toEqual(['status']);
    expect(outcomes[0].error).toBeUndefined();
    expect(rewrittenPaths).toEqual(['notes/a.md']);

    const onDisk = await fsp.readFile(path.join(root, 'notes/a.md'), 'utf-8');
    expect(onDisk).toContain('status: done');
    // Trust principle: an approved proposal backs the write.
    expect(await approvedRewriteCount()).toBe(1);
  });

  it('is non-fatal per note: a failing entry does not block the others', async () => {
    await plant('notes/ok.md', '# OK\n');
    const { outcomes, rewrittenPaths } = await applyPropertyUpdates(
      root,
      [
        { relativePath: 'notes/missing.md', properties: { x: 1 } }, // read throws
        { relativePath: 'notes/ok.md', properties: { x: 1 } },
      ],
      'conv-1',
    );

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].error).toBeTruthy();      // missing file surfaced, not thrown
    expect(outcomes[1].changedKeys).toEqual(['x']);
    expect(rewrittenPaths).toEqual(['notes/ok.md']);
    // Only the successful note filed a proposal.
    expect(await approvedRewriteCount()).toBe(1);
  });

  it('surfaces an empty-properties payload as an error and writes nothing', async () => {
    await plant('notes/a.md', '# A\n');
    const { outcomes, rewrittenPaths } = await applyPropertyUpdates(
      root,
      [{ relativePath: 'notes/a.md', properties: {} }],
      'conv-1',
    );
    expect(outcomes[0].error).toMatch(/empty/i);
    expect(rewrittenPaths).toEqual([]);
    expect(await approvedRewriteCount()).toBe(0);
  });

  it('files no proposal for a no-op patch (key already at that value)', async () => {
    await plant('notes/a.md', '---\nstatus: done\n---\n# A\n');
    const { outcomes, rewrittenPaths } = await applyPropertyUpdates(
      root,
      [{ relativePath: 'notes/a.md', properties: { status: 'done' } }],
      'conv-1',
    );
    expect(outcomes[0].changedKeys).toEqual([]);
    expect(rewrittenPaths).toEqual([]);
    expect(await approvedRewriteCount()).toBe(0);
  });
});
