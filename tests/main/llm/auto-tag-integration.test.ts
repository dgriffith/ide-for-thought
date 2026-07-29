/**
 * Integration coverage for the Auto-tag orchestrator (#342).
 *
 * Drives `runAutoTag()` end-to-end: a real notebase file on disk, a real
 * graph projection (so `listTags` returns real vocabulary), and a mocked
 * LLM response. Asserts the merged frontmatter the orchestrator returns
 * matches what the apply step will eventually persist.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const { completeMock, getSettingsMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock('../../../src/main/llm/index', () => ({ complete: completeMock }));
vi.mock('../../../src/main/llm/settings', () => ({ getSettings: getSettingsMock }));

import { runAutoTag, applyAutoTag } from '../../../src/main/llm/auto-tag';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { extractTagsFromContent } from '../../../src/shared/refactor/auto-tag';

describe('runAutoTag() integration (#342)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-autotag-int-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    completeMock.mockReset();
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ model: 'claude-sonnet-4-6', providers: { anthropic: { apiKey: 'fake' } } });
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function plant(rel: string, content: string): Promise<void> {
    const full = path.join(root, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content, 'utf-8');
    await indexNote(ctx, rel, content);
  }

  it('merges new tags into a note with no frontmatter', async () => {
    await plant('notes/llm-trust.md', '# LLM Trust\n\nSome thoughts on trust.\n');
    completeMock.mockResolvedValueOnce('llm-trust\nepistemics\n');

    const plan = await runAutoTag(root, 'notes/llm-trust.md');
    expect(plan.added.sort()).toEqual(['epistemics', 'llm-trust']);
    expect(plan.content).not.toBeNull();
    expect(plan.content!.startsWith('---\n')).toBe(true);
    expect(plan.content).toContain('llm-trust');
    expect(plan.content).toContain('epistemics');
    expect(plan.content!.endsWith('# LLM Trust\n\nSome thoughts on trust.\n')).toBe(true);
  });

  it('skips tags the note already has (case-insensitive)', async () => {
    const existing = '---\ntags:\n  - LLM-Trust\n---\n# LLM Trust\n\nBody.\n';
    await plant('notes/llm-trust.md', existing);
    completeMock.mockResolvedValueOnce('llm-trust\nnew-thing\n');

    const plan = await runAutoTag(root, 'notes/llm-trust.md');
    expect(plan.added).toEqual(['new-thing']);
    expect(plan.content).toContain('LLM-Trust');
    expect(plan.content).toContain('new-thing');
  });

  it('returns the no-op shape when the LLM proposes nothing new', async () => {
    await plant('notes/x.md', '---\ntags:\n  - already-here\n---\n# X\nBody.\n');
    completeMock.mockResolvedValueOnce('already-here\n');

    const plan = await runAutoTag(root, 'notes/x.md');
    expect(plan.added).toEqual([]);
    expect(plan.content).toBeNull();
  });

  it('returns the no-op shape when the LLM returns an empty list', async () => {
    await plant('notes/x.md', '# X\nShort.\n');
    completeMock.mockResolvedValueOnce('');

    const plan = await runAutoTag(root, 'notes/x.md');
    expect(plan.added).toEqual([]);
    expect(plan.content).toBeNull();
  });

  it('seeds the prompt with the thoughtbase’s existing tag vocabulary', async () => {
    await plant('notes/a.md', '---\ntags:\n  - shared-tag\n---\n# A\n');
    await plant('notes/b.md', '---\ntags:\n  - other-tag\n---\n# B\n');
    completeMock.mockResolvedValueOnce('');

    await runAutoTag(root, 'notes/a.md');
    expect(completeMock).toHaveBeenCalledTimes(1);
    const prompt = completeMock.mock.calls[0][0] as string;
    // Vocabulary section must include tags from sibling notes; the active
    // note's own tag is also listed (under both sections — the orchestrator
    // doesn't dedupe across them, and that's fine for the prompt).
    expect(prompt).toContain('other-tag');
    expect(prompt).toContain('shared-tag');
  });
});

describe('applyAutoTag() routes through the approval engine (#940)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-autotag-apply-'));
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

  /** Count of approved note_rewrite proposals in the store — proof the write
   *  went through the approval engine rather than bypassing it. */
  async function approvedRewriteProposals(): Promise<number> {
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?p WHERE {
        ?p a thought:Proposal ;
           thought:operationType "note_rewrite" ;
           thought:proposalStatus thought:approved .
      }`);
    return r.results.length;
  }

  it('merges accepted tags into the note AND files an approved note_rewrite proposal', async () => {
    await plant('notes/x.md', '# X\n\nBody.\n');
    const result = await applyAutoTag(root, 'notes/x.md', ['alpha', 'beta']);

    expect(result.applied.sort()).toEqual(['alpha', 'beta']);
    expect(result.rewrittenPaths).toEqual(['notes/x.md']);

    // The file on disk actually carries the tags now.
    const onDisk = await fsp.readFile(path.join(root, 'notes/x.md'), 'utf-8');
    expect(extractTagsFromContent(onDisk).sort()).toEqual(['alpha', 'beta']);

    // Trust principle: the write left an approved proposal behind (not a bypass).
    expect(await approvedRewriteProposals()).toBe(1);
  });

  it('recomputes against current disk content and no-ops when tags already present', async () => {
    await plant('notes/y.md', '---\ntags:\n  - kept\n---\n# Y\n');
    const result = await applyAutoTag(root, 'notes/y.md', ['kept']);
    expect(result.applied).toEqual([]);
    expect(result.rewrittenPaths).toEqual([]);
    // No pointless proposal filed for a no-op.
    expect(await approvedRewriteProposals()).toBe(0);
  });
});
