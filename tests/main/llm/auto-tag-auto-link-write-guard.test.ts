/**
 * Write-guard regression for the auto-tag/auto-link "apply" paths (#944,
 * #1901). CLAUDE.md's Write Guard section names `applyAutoTag`,
 * `fileAutoLinkOutbound`, and `fileAutoLinkInbound` among the "converged LLM
 * apply paths" that wrap themselves in `graph.withLLMContext` so a write
 * that skips the approval engine's trusted-context wrapping is caught
 * rather than landing silently.
 *
 * `auto-tag-integration.test.ts` and `auto-link-integration.test.ts` already
 * prove the HONEST path — an approved proposal backs the write. This proves
 * the GUARD: `llm/approval` is mocked so `approveProposal` simulates a
 * hypothetical regression in `approval.ts` itself (applying a bundle
 * without its own `enterTrustedContext()` wrapping around the graph write),
 * and each function is asserted to reject rather than silently applying.
 * If any of their `withLLMContext` wrappers were ever removed, these flip
 * from "rejects" to "resolves."
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';

const h = vi.hoisted(() => ({
  proposeWrite: vi.fn(),
  approveProposal: vi.fn(),
}));

vi.mock('../../../src/main/llm/approval', () => ({
  proposeWrite: h.proposeWrite,
  approveProposal: h.approveProposal,
}));

import { applyAutoTag } from '../../../src/main/llm/auto-tag';
import { fileAutoLinkOutbound, fileAutoLinkInbound } from '../../../src/main/llm/auto-link';
import { indexNote } from '../../../src/main/graph/index';
import { __resetWriteGuardForTests } from '../../../src/main/graph/write-guard';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('LLM apply-path write guard (#944, #1901)', () => {
  const project = useGraphProject('minerva-refactor-guard-');
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetWriteGuardForTests();
    root = project.root;
    ctx = project.ctx;
  });

  afterEach(() => {
    __resetWriteGuardForTests();
  });

  async function plant(rel: string, content: string): Promise<void> {
    const full = path.join(root, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content, 'utf-8');
    await indexNote(ctx, rel, content);
  }

  // Simulates a regression in approval.ts: applying the bundle without its
  // own enterTrustedContext() wrapping around the graph write. The caller's
  // withLLMContext wrapper is what's SUPPOSED to catch this.
  function bypassApprove(relPath: string, content: string): void {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:bypass' });
    h.approveProposal.mockImplementation(async () => {
      await indexNote(ctx, relPath, content);
      return { ok: true, filedPaths: [relPath], rewrittenPaths: [relPath] };
    });
  }

  it('applyAutoTag rejects when approveProposal bypasses the trusted context', async () => {
    await plant('notes/x.md', '# X\n\nBody.\n');
    bypassApprove('notes/x.md', '---\ntags:\n  - alpha\n---\n# X\n');

    await expect(applyAutoTag(root, 'notes/x.md', ['alpha', 'beta'])).rejects.toThrow(/trust-guard/);
  });

  it('fileAutoLinkOutbound rejects when approveProposal bypasses the trusted context', async () => {
    await plant('notes/active.md', '# Active\n\nThis mentions cognitive bias here.\n');
    await plant('notes/cognitive-bias.md', '# Cognitive Bias\n');
    bypassApprove('notes/active.md', 'rewritten');
    const accepted = [{ anchorText: 'cognitive bias', target: 'notes/cognitive-bias.md', rationale: 'r.' }];

    await expect(fileAutoLinkOutbound(root, 'notes/active.md', accepted)).rejects.toThrow(/trust-guard/);
  });

  it('fileAutoLinkInbound rejects when approveProposal bypasses the trusted context', async () => {
    await plant('notes/active.md', '# Widgets\n');
    await plant('notes/source-a.md', '# A\n\nWe use widgets daily.\n');
    bypassApprove('notes/source-a.md', 'rewritten');
    const accepted = [{ source: 'notes/source-a.md', anchorText: 'widgets', rationale: 'r.', contextSnippet: '' }];

    await expect(fileAutoLinkInbound(root, 'notes/active.md', accepted)).rejects.toThrow(/trust-guard/);
  });
});
