/**
 * `CONVERSATION_FILE_NOTE_BODY_DRAFT`'s LLM write guard (#944, #1900).
 *
 * Of the eleven handlers in `register-conversation-drafts.ts`, this is the
 * only one that wraps itself in `graph.withLLMContext` (see CLAUDE.md's
 * "Write Guard" section) — arming `checkLLMWriteGuard` so a write that skips
 * the approval engine's trusted-context wrapping is caught rather than
 * landing silently. Proving that matters needs the REAL graph/write-guard
 * machinery, which is why this is a separate file from
 * `register-conversation-drafts.test.ts`: that file stubs `graph/index`
 * wholesale for speed/isolation, which would make the guard a no-op here.
 *
 * `approval.proposeWrite`/`approveProposal` are still mocked — but the mock
 * simulates a hypothetical regression in `approval.ts` itself (applying a
 * bundle without its own `enterTrustedContext()` wrapping), so the ONLY
 * thing standing between that regression and a silent bypass is this
 * handler's `withLLMContext` wrapper. If that wrapper were ever removed,
 * this test flips from "rejects" to "resolves" — the failure a future
 * refactor should see.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const h = vi.hoisted(() => ({
  proposeWrite: vi.fn(),
  approveProposal: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(channel, fn); } },
}));
vi.mock('../../../src/main/llm/approval', () => ({
  proposeWrite: h.proposeWrite,
  approveProposal: h.approveProposal,
}));
vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath: (fn: unknown) => fn,
  withRootPathWin: (fn: unknown) => fn,
  reindexFile: vi.fn(),
  persistIndexes: vi.fn(),
  hooks: { broadcastRewritten: vi.fn() },
}));
vi.mock('../../../src/main/ipc/register-compute', () => ({
  formatComputeResultAsContext: vi.fn(),
  recordComputeProposalRun: vi.fn(),
  buildComputeProposalNoteBlock: vi.fn(),
}));
vi.mock('../../../src/main/notebase/fs', () => ({}));
vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: vi.fn() }));
vi.mock('../../../src/main/history', () => ({ runWithHistorySource: (_opts: unknown, fn: () => unknown) => fn() }));
vi.mock('../../../src/main/sources/ingest', () => ({ ingestUrl: vi.fn() }));
vi.mock('../../../src/main/sources/ingest-identifier', () => ({ ingestIdentifier: vi.fn() }));
vi.mock('../../../src/main/privileged-sites', () => ({ privilegedFetch: vi.fn() }));
vi.mock('../../../src/main/sources/source-meta-write', () => ({ ttlString: vi.fn() }));
vi.mock('../../../src/main/llm/source-properties', () => ({ fileSourceProperties: vi.fn() }));
vi.mock('../../../src/main/compute/registry', () => ({ runCell: vi.fn() }));
vi.mock('../../../src/main/compute/consent', () => ({ computeConsentGuard: vi.fn() }));
vi.mock('../../../src/main/compute/audit', () => ({ recordExecution: vi.fn() }));
vi.mock('../../../src/main/sources/create-excerpt', () => ({ buildExcerptTtl: vi.fn() }));
vi.mock('../../../src/main/llm/set-properties', () => ({ applyPropertyUpdates: vi.fn() }));
vi.mock('../../../src/main/llm/conversation', () => ({ appendMessage: vi.fn() }));
// graph/index is deliberately NOT mocked — this file's whole point is
// exercising the real write guard wired into the real graph write path.

import { registerConversationDrafts } from '../../../src/main/ipc/register-conversation-drafts';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { __resetWriteGuardForTests } from '../../../src/main/graph/write-guard';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { Channels } from '../../../src/shared/channels';

registerConversationDrafts();
const call = (channel: string, ...args: unknown[]): unknown => h.handlers.get(channel)!(...args);

describe('CONVERSATION_FILE_NOTE_BODY_DRAFT — write guard wired (#1900)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    vi.clearAllMocks();
    __resetWriteGuardForTests();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-conv-drafts-guard-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    __resetWriteGuardForTests();
  });

  it('rejects when approveProposal writes to the graph without the approval engine\'s trusted context', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:guard' });
    // Simulates a regression in approval.ts: applying the bundle without its
    // own enterTrustedContext() wrapping around the graph write. The
    // handler's withLLMContext wrapper is what's SUPPOSED to catch this.
    h.approveProposal.mockImplementation(async () => {
      await indexNote(ctx, 'a.md', '# untrusted write');
      return { ok: true, filedPaths: ['a.md'], rewrittenPaths: [] };
    });
    const draft = { draftId: 'g1', conversationId: 'c1', note: 'x', items: [{ relativePath: 'a.md', afterContent: 'y' }] };

    await expect(call(Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT, root, draft, undefined))
      .rejects.toThrow(/trust-guard/);
  });

  it('control: the same write OUTSIDE this handler does not throw', async () => {
    // Proves the throw above comes from being inside the handler's LLM
    // context, not from indexNote itself being broken or always throwing.
    await expect(indexNote(ctx, 'a.md', '# untrusted write')).resolves.toBeDefined();
  });
});
