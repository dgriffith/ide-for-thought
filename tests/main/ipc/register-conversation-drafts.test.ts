/**
 * `fileAndApprove()` in `register-conversation-drafts.ts` (#1895).
 *
 * Extracted from six duplicated `proposeWrite → if (proposal) approveProposal
 * → return { applied: true }` blocks, one per draft-filing IPC handler. The
 * duplication itself was harmless, but the hardcoded `applied: true` wasn't:
 * every call site claimed success even on the `proposal` was falsy branch,
 * the same shape as the vestigial `GIT_COMMIT.success` CLAUDE.md already
 * flags. This tests the helper directly rather than every handler that now
 * delegates to it — see #1900 for broader IPC-level coverage of these six
 * channels, which had none before this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  proposeWrite: vi.fn(),
  approveProposal: vi.fn(),
}));

vi.mock('../../../src/main/llm/approval', () => ({
  proposeWrite: h.proposeWrite,
  approveProposal: h.approveProposal,
}));

// register-conversation-drafts.ts's other imports pull in a large surface
// (compute, sources ingest, history, ./helpers → window-manager → electron's
// app.getPath called eagerly at module scope) that fileAndApprove itself
// never touches. Stub them so the module loads without that chain.
vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath: (fn: unknown) => fn,
  withRootPathWin: (fn: unknown) => fn,
  reindexFile: vi.fn(),
  persistIndexes: vi.fn(),
  hooks: {},
}));
vi.mock('../../../src/main/ipc/typed-ipc', () => ({ handle: vi.fn() }));
vi.mock('../../../src/main/ipc/register-compute', () => ({
  formatComputeResultAsContext: vi.fn(),
  recordComputeProposalRun: vi.fn(),
  buildComputeProposalNoteBlock: vi.fn(),
}));
vi.mock('../../../src/main/notebase/fs', () => ({}));
vi.mock('../../../src/main/graph/index', () => ({ withLLMContext: (fn: () => unknown) => fn() }));
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
vi.mock('../../../src/main/notebase/reorg', () => ({ orderRefactors: vi.fn() }));
vi.mock('../../../src/main/llm/conversation', () => ({ appendMessage: vi.fn() }));

import { fileAndApprove } from '../../../src/main/ipc/register-conversation-drafts';
import { projectContext } from '../../../src/main/project-context-types';

const CTX = projectContext('/vault');
const WRITE = {
  operationType: 'component_creation' as const,
  payloads: [],
  note: 'test',
  proposedBy: 'llm:conversation:c1',
};

beforeEach(() => { vi.clearAllMocks(); });

describe('fileAndApprove', () => {
  it('files and approves, returning the real approve result', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:proposal:1' });
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: ['a.md'], rewrittenPaths: ['b.md'] });

    const result = await fileAndApprove(CTX, WRITE);

    expect(h.proposeWrite).toHaveBeenCalledWith(CTX, WRITE);
    expect(h.approveProposal).toHaveBeenCalledWith(CTX, 'urn:proposal:1');
    expect(result).toEqual({
      proposalUri: 'urn:proposal:1',
      applied: true,
      filedPaths: ['a.md'],
      rewrittenPaths: ['b.md'],
    });
  });

  // The #1895 bug this closes: a falsy proposal must not read as `applied: true`.
  it('reports applied: false and skips approveProposal when proposeWrite returns falsy', async () => {
    h.proposeWrite.mockResolvedValue(null);

    const result = await fileAndApprove(CTX, WRITE);

    expect(h.approveProposal).not.toHaveBeenCalled();
    expect(result).toEqual({ proposalUri: null, applied: false, filedPaths: [], rewrittenPaths: [] });
  });

  // Equally load-bearing: a proposal that WAS filed but failed to apply
  // (revoked mid-flight, a payload apply error) must also report applied:
  // false — the old hardcoded `applied: true` got this case wrong too, and
  // unlike the falsy-proposal branch, this one is genuinely reachable today.
  it('reports applied: false when the proposal was filed but approveProposal fails', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:proposal:2' });
    h.approveProposal.mockResolvedValue({ ok: false, filedPaths: [], rewrittenPaths: [] });

    const result = await fileAndApprove(CTX, WRITE);

    expect(result).toEqual({
      proposalUri: 'urn:proposal:2',
      applied: false,
      filedPaths: [],
      rewrittenPaths: [],
    });
  });
});
