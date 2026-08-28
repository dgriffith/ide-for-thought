/**
 * `register-conversation-drafts.ts` (#1895, #1900).
 *
 * `fileAndApprove()` was extracted in #1895 from six duplicated
 * `proposeWrite → if (proposal) approveProposal → return { applied: true }`
 * blocks. This file has two halves:
 *
 *  - A direct unit-test of `fileAndApprove` itself (below), covering the
 *    success path and both failure shapes (a falsy `proposal`, and a
 *    proposal that was filed but failed to apply).
 *  - IPC-level coverage of the handlers `registerConversationDrafts()`
 *    registers, driving each through the real `handle()` → `ipcMain.handle`
 *    wiring with only the domain modules mocked. Before this file, six of
 *    the eleven channels here (`CONVERSATION_FILE_REFACTOR_DRAFT`,
 *    `_REORG_DRAFT`, `_NOTE_BODY_DRAFT`, `_CLAIMS_DRAFT`,
 *    `_PROPERTY_DRAFT`, `_RUN_COMPUTE_DRAFT`/`_INSERT_COMPUTE_DRAFT`) had
 *    zero test references anywhere (#1900) — exactly the "approve and
 *    apply, no second review" path CLAUDE.md's LLM/Graph checklist asks
 *    about.
 *
 * Two of the eleven — `CONVERSATION_RUN_COMPUTE_DRAFT` and
 * `_INSERT_COMPUTE_DRAFT` — do NOT go through `proposeWrite`/
 * `approveProposal`: the compute "Run" action is gated by the separate
 * per-cell consent guard (#1411/#1412), and "Insert into note" is a plain
 * user-directed write, not an LLM auto-apply. Their tests assert the trust
 * mechanism that actually applies to them instead of forcing an
 * approval-engine assertion that doesn't.
 *
 * The write-guard regression for `CONVERSATION_FILE_NOTE_BODY_DRAFT`'s
 * `withLLMContext` wrapper — the one handler here that arms it — lives in
 * `register-conversation-drafts-write-guard.test.ts` instead: it needs the
 * REAL graph module to exercise the real guard, which conflicts with this
 * file's blanket `graph/index` stub.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  proposeWrite: vi.fn(),
  approveProposal: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  broadcastRewritten: vi.fn(),
  readFile: vi.fn(),
  writeAndReindex: vi.fn(),
  applyPropertyUpdates: vi.fn(),
  computeConsentGuard: vi.fn(),
  runCell: vi.fn(),
  recordExecution: vi.fn(),
  appendMessage: vi.fn(),
  recordComputeProposalRun: vi.fn(),
  buildComputeProposalNoteBlock: vi.fn(),
  formatComputeResultAsContext: vi.fn(),
  buildExcerptTtl: vi.fn(),
  fileSourceProperties: vi.fn(),
  ingestUrl: vi.fn(),
  ingestIdentifier: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { h.handlers.set(channel, fn); } },
}));

vi.mock('../../../src/main/llm/approval', () => ({
  proposeWrite: h.proposeWrite,
  approveProposal: h.approveProposal,
}));

// register-conversation-drafts.ts's other imports pull in a large surface
// (compute, sources ingest, history, ./helpers → window-manager → electron's
// app.getPath called eagerly at module scope) that most of these handlers
// never touch. Stub them so the module loads without that chain; each stub
// is wired to `h` so a test can configure/assert on it.
vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath: (fn: unknown) => fn,
  withRootPathWin: (fn: unknown) => fn,
  reindexFile: vi.fn(),
  persistIndexes: vi.fn(),
  hooks: { broadcastRewritten: h.broadcastRewritten },
}));
vi.mock('../../../src/main/ipc/register-compute', () => ({
  formatComputeResultAsContext: h.formatComputeResultAsContext,
  recordComputeProposalRun: h.recordComputeProposalRun,
  buildComputeProposalNoteBlock: h.buildComputeProposalNoteBlock,
}));
vi.mock('../../../src/main/notebase/fs', () => ({ readFile: h.readFile }));
vi.mock('../../../src/main/graph/index', () => ({ withLLMContext: (fn: () => unknown) => fn() }));
vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: h.writeAndReindex }));
vi.mock('../../../src/main/history', () => ({ runWithHistorySource: (_opts: unknown, fn: () => unknown) => fn() }));
vi.mock('../../../src/main/sources/ingest', () => ({ ingestUrl: h.ingestUrl }));
vi.mock('../../../src/main/sources/ingest-identifier', () => ({ ingestIdentifier: h.ingestIdentifier }));
vi.mock('../../../src/main/privileged-sites', () => ({ privilegedFetch: vi.fn() }));
vi.mock('../../../src/main/sources/source-meta-write', () => ({ ttlString: (s: string) => JSON.stringify(s) }));
vi.mock('../../../src/main/llm/source-properties', () => ({ fileSourceProperties: h.fileSourceProperties }));
vi.mock('../../../src/main/compute/registry', () => ({ runCell: h.runCell }));
vi.mock('../../../src/main/compute/consent', () => ({ computeConsentGuard: h.computeConsentGuard }));
vi.mock('../../../src/main/compute/audit', () => ({ recordExecution: h.recordExecution }));
vi.mock('../../../src/main/sources/create-excerpt', () => ({ buildExcerptTtl: h.buildExcerptTtl }));
vi.mock('../../../src/main/llm/set-properties', () => ({ applyPropertyUpdates: h.applyPropertyUpdates }));
vi.mock('../../../src/main/llm/conversation', () => ({ appendMessage: h.appendMessage }));
// notebase/reorg is NOT mocked — orderRefactors is pure, already covered by
// its own tests, and real behavior is what the REORG_DRAFT test wants.

import { fileAndApprove, registerConversationDrafts } from '../../../src/main/ipc/register-conversation-drafts';
import { projectContext } from '../../../src/main/project-context-types';
import { Channels } from '../../../src/shared/channels';

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

registerConversationDrafts();
const call = (channel: string, ...args: unknown[]): unknown => h.handlers.get(channel)!(...args);

describe('CONVERSATION_FILE_REFACTOR_DRAFT (#1900)', () => {
  it('files a note_refactor proposal and auto-approves it', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:refactor' });
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: [], rewrittenPaths: [] });
    const draft = { draftId: 'r1', conversationId: 'c1', fromPath: 'a.md', toPath: 'b.md', note: 'move a to b' };

    const res = await call(Channels.CONVERSATION_FILE_REFACTOR_DRAFT, '/vault', draft);

    expect(h.proposeWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      operationType: 'note_refactor',
      payloads: [{ kind: 'note-refactor', fromPath: 'a.md', toPath: 'b.md' }],
      note: 'move a to b',
      conversationUri: 'https://minerva.dev/ontology/thought#conversation/c1',
      proposedBy: 'llm:conversation:c1',
    }));
    expect(h.approveProposal).toHaveBeenCalledWith(expect.anything(), 'urn:p:refactor');
    expect(res).toEqual({ proposalUri: 'urn:p:refactor', applied: true });
  });

  it('files a folder-refactor payload when the draft is a folder move', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:folder' });
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: [], rewrittenPaths: [] });
    const draft = { draftId: 'r2', conversationId: 'c1', fromPath: 'old', toPath: 'new', isFolder: true, note: 'move folder' };

    await call(Channels.CONVERSATION_FILE_REFACTOR_DRAFT, '/vault', draft);

    expect(h.proposeWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      payloads: [{ kind: 'folder-refactor', fromPath: 'old', toPath: 'new' }],
    }));
  });

  it('throws without filing anything when fromPath/toPath is missing', async () => {
    await expect(call(Channels.CONVERSATION_FILE_REFACTOR_DRAFT, '/vault', { conversationId: 'c1' }))
      .rejects.toThrow(/missing fromPath\/toPath/);
    expect(h.proposeWrite).not.toHaveBeenCalled();
  });
});

describe('CONVERSATION_FILE_REORG_DRAFT (#1900)', () => {
  it('orders the selected moves and files them as ONE note_refactor proposal', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:reorg' });
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: [], rewrittenPaths: [] });
    const draft = { draftId: 'g1', conversationId: 'c1', note: 'reorg', items: [], warnings: [] };
    const selected = [{ fromPath: 'a.md', toPath: 'b.md' }, { fromPath: 'c.md', toPath: 'd.md' }];

    const res = await call(Channels.CONVERSATION_FILE_REORG_DRAFT, '/vault', draft, selected);

    expect(h.proposeWrite).toHaveBeenCalledTimes(1);
    const sent = h.proposeWrite.mock.calls[0]![1] as { payloads: Array<{ kind: string }> };
    expect(sent.payloads).toHaveLength(2);
    expect(sent.payloads.every((p) => p.kind === 'note-refactor')).toBe(true);
    expect(h.approveProposal).toHaveBeenCalledWith(expect.anything(), 'urn:p:reorg');
    expect(res).toEqual({ proposalUri: 'urn:p:reorg', applied: true });
  });

  it('files folder-refactor payloads for a folder-batch reorg', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:reorg-folder' });
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: [], rewrittenPaths: [] });
    const draft = { draftId: 'g2', conversationId: 'c1', note: 'reorg folders', isFolder: true, items: [], warnings: [] };

    await call(Channels.CONVERSATION_FILE_REORG_DRAFT, '/vault', draft, [{ fromPath: 'a', toPath: 'b' }]);

    const sent = h.proposeWrite.mock.calls[0]![1] as { payloads: Array<{ kind: string }> };
    expect(sent.payloads).toEqual([{ kind: 'folder-refactor', fromPath: 'a', toPath: 'b' }]);
  });

  it('returns proposalUri: null, applied: false without filing anything when nothing is selected', async () => {
    const draft = { draftId: 'g3', conversationId: 'c1', note: 'reorg', items: [], warnings: [] };

    const res = await call(Channels.CONVERSATION_FILE_REORG_DRAFT, '/vault', draft, []);

    expect(res).toEqual({ proposalUri: null, applied: false });
    expect(h.proposeWrite).not.toHaveBeenCalled();
  });
});

describe('CONVERSATION_FILE_NOTE_BODY_DRAFT (#1900)', () => {
  it('files ONE note_rewrite proposal for the kept items, auto-approves, and broadcasts the rewritten paths', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:notebody' });
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: [], rewrittenPaths: ['a.md', 'b.md'] });
    const draft = {
      draftId: 'nb1', conversationId: 'c1', note: 'rewrite',
      items: [
        { relativePath: 'a.md', afterContent: 'new a' },
        { relativePath: 'b.md', afterContent: 'new b' },
      ],
    };

    const res = await call(Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT, '/vault', draft, undefined);

    expect(h.proposeWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      operationType: 'note_rewrite',
      payloads: [
        { kind: 'note-rewrite', path: 'a.md', content: 'new a' },
        { kind: 'note-rewrite', path: 'b.md', content: 'new b' },
      ],
    }));
    expect(h.broadcastRewritten).toHaveBeenCalledWith('/vault', ['a.md', 'b.md']);
    expect(res).toEqual({ proposalUri: 'urn:p:notebody', applied: true });
  });

  it('only files the SELECTED items when a selection is given', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:notebody2' });
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: [], rewrittenPaths: [] });
    const draft = {
      draftId: 'nb2', conversationId: 'c1', note: 'rewrite',
      items: [
        { relativePath: 'a.md', afterContent: 'new a' },
        { relativePath: 'b.md', afterContent: 'new b' },
      ],
    };

    await call(Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT, '/vault', draft, ['b.md']);

    const sent = h.proposeWrite.mock.calls[0]![1] as { payloads: unknown[] };
    expect(sent.payloads).toEqual([{ kind: 'note-rewrite', path: 'b.md', content: 'new b' }]);
  });

  it('returns proposalUri: null, applied: false when the selection keeps nothing', async () => {
    const draft = { draftId: 'nb3', conversationId: 'c1', note: 'rewrite', items: [{ relativePath: 'a.md', afterContent: 'x' }] };

    const res = await call(Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT, '/vault', draft, ['not-in-draft.md']);

    expect(res).toEqual({ proposalUri: null, applied: false });
    expect(h.proposeWrite).not.toHaveBeenCalled();
  });

  it('throws when the draft has no items', async () => {
    await expect(call(Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT, '/vault', { conversationId: 'c1', items: [] }, undefined))
      .rejects.toThrow(/FILE_NOTE_BODY_DRAFT/);
  });
});

describe('CONVERSATION_FILE_CLAIMS_DRAFT (#1900)', () => {
  it('files a deduped excerpt+note bundle and auto-approves it', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'urn:p:claims' });
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: [], rewrittenPaths: [] });
    const draft = {
      draftId: 'cl1', conversationId: 'c1', sourceId: 'src1', note: 'claims',
      claims: [
        { text: 'Claim One', kind: 'empirical', quote: 'q1', confidence: 0.9, excerptId: 'ex1' },
        // Shares excerptId with the first claim — the excerpt payload must be deduped.
        { text: 'Claim Two', kind: 'empirical', quote: 'q2', confidence: 0.8, excerptId: 'ex1' },
      ],
    };

    const res = await call(Channels.CONVERSATION_FILE_CLAIMS_DRAFT, '/vault', draft);

    expect(h.proposeWrite).toHaveBeenCalledTimes(1);
    const sent = h.proposeWrite.mock.calls[0]![1] as { operationType: string; payloads: Array<{ kind: string }> };
    expect(sent.operationType).toBe('component_creation');
    expect(sent.payloads.filter((p) => p.kind === 'excerpt')).toHaveLength(1);
    expect(sent.payloads.filter((p) => p.kind === 'note')).toHaveLength(2);
    expect(h.approveProposal).toHaveBeenCalledWith(expect.anything(), 'urn:p:claims');
    expect(res).toEqual({
      outcome: {
        sourceId: 'src1',
        claimPaths: [expect.stringContaining('src1-1-'), expect.stringContaining('src1-2-')],
        excerptIds: ['ex1'],
      },
    });
  });

  it('throws when the draft has no sourceId', async () => {
    const draft = { draftId: 'cl2', conversationId: 'c1', claims: [{ text: 'x', kind: 'empirical', quote: 'q', confidence: 0.5, excerptId: 'e' }] };
    await expect(call(Channels.CONVERSATION_FILE_CLAIMS_DRAFT, '/vault', draft)).rejects.toThrow(/FILE_CLAIMS_DRAFT/);
  });

  it('reports a proposeWrite failure on the outcome instead of throwing (per-source, non-fatal)', async () => {
    h.proposeWrite.mockRejectedValue(new Error('graph write failed'));
    const draft = {
      draftId: 'cl3', conversationId: 'c1', sourceId: 'src2', note: 'claims',
      claims: [{ text: 'x', kind: 'empirical', quote: 'q', confidence: 0.5, excerptId: 'e' }],
    };

    const res = await call(Channels.CONVERSATION_FILE_CLAIMS_DRAFT, '/vault', draft);

    expect(res).toEqual({ outcome: { sourceId: 'src2', claimPaths: [], excerptIds: [], error: 'graph write failed' } });
  });
});

// #1900 — CONVERSATION_FILE_SOURCE_DRAFT doesn't go through proposeWrite/
// approveProposal either: it runs the existing ingestUrl/ingestIdentifier
// pipelines per source, the same path a user's own "Ingest URL…" menu
// action takes.
describe('CONVERSATION_FILE_SOURCE_DRAFT (#1900)', () => {
  const fakeWin = () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } });

  it('ingests by identifier, reindexes, persists, and broadcasts SOURCES_CHANGED', async () => {
    h.ingestIdentifier.mockResolvedValue({ sourceId: 's1', title: 'Paper One', duplicate: false, relativePath: '.minerva/sources/s1/meta.ttl' });
    const win = fakeWin();
    const draft = { draftId: 'sd1', conversationId: 'c1', sources: [{ identifier: '10.1000/xyz' }] };

    const res = await call(Channels.CONVERSATION_FILE_SOURCE_DRAFT, '/vault', win, draft);

    expect(h.ingestIdentifier).toHaveBeenCalledWith('/vault', '10.1000/xyz', expect.anything());
    expect(win.webContents.send).toHaveBeenCalledWith(Channels.SOURCES_CHANGED);
    expect(res).toEqual({ outcomes: [{ input: { identifier: '10.1000/xyz' }, sourceId: 's1', title: 'Paper One', duplicate: false }] });
  });

  it('ingests by url when no identifier is given', async () => {
    h.ingestUrl.mockResolvedValue({ sourceId: 's2', title: 'Web Page', duplicate: false, relativePath: '.minerva/sources/s2/meta.ttl' });
    const draft = { draftId: 'sd2', conversationId: 'c1', sources: [{ url: 'https://example.com' }] };

    const res = await call(Channels.CONVERSATION_FILE_SOURCE_DRAFT, '/vault', fakeWin(), draft);

    expect(h.ingestUrl).toHaveBeenCalledWith('/vault', 'https://example.com', expect.anything());
    expect(res).toEqual({ outcomes: [{ input: { url: 'https://example.com' }, sourceId: 's2', title: 'Web Page', duplicate: false }] });
  });

  it('reports a per-source ingest failure on its own outcome — one bad entry does not block the rest', async () => {
    h.ingestUrl.mockRejectedValue(new Error('fetch failed'));
    h.ingestIdentifier.mockResolvedValue({ sourceId: 's3', title: 'OK', duplicate: false, relativePath: 'x' });
    const draft = {
      draftId: 'sd3', conversationId: 'c1',
      sources: [{ url: 'https://bad.example' }, { identifier: '10.1/ok' }],
    };

    const res = await call(Channels.CONVERSATION_FILE_SOURCE_DRAFT, '/vault', fakeWin(), draft);

    expect(res).toEqual({
      outcomes: [
        { input: { url: 'https://bad.example' }, error: 'fetch failed' },
        { input: { identifier: '10.1/ok' }, sourceId: 's3', title: 'OK', duplicate: false },
      ],
    });
  });

  it('reports a malformed entry (neither identifier nor url) without throwing', async () => {
    const draft = { draftId: 'sd4', conversationId: 'c1', sources: [{}] };

    const res = await call(Channels.CONVERSATION_FILE_SOURCE_DRAFT, '/vault', fakeWin(), draft);

    expect(res).toEqual({ outcomes: [{ input: {}, error: 'Source entry has neither `identifier` nor `url`.' }] });
  });

  it('throws when the draft has no sources', async () => {
    await expect(call(Channels.CONVERSATION_FILE_SOURCE_DRAFT, '/vault', fakeWin(), { conversationId: 'c1', sources: [] }))
      .rejects.toThrow(/FILE_SOURCE_DRAFT/);
  });
});

describe('CONVERSATION_FILE_PROPERTY_DRAFT (#1900)', () => {
  it('delegates to applyPropertyUpdates and broadcasts the rewritten paths', async () => {
    const draft = { draftId: 'p1', conversationId: 'c1', updates: [{ relativePath: 'a.md', properties: { status: 'done' } }] };
    h.applyPropertyUpdates.mockResolvedValue({
      outcomes: [{ relativePath: 'a.md', changedKeys: ['status'], deletedKeys: [] }],
      rewrittenPaths: ['a.md'],
    });

    const res = await call(Channels.CONVERSATION_FILE_PROPERTY_DRAFT, '/vault', draft);

    expect(h.applyPropertyUpdates).toHaveBeenCalledWith('/vault', draft.updates, 'c1');
    expect(h.broadcastRewritten).toHaveBeenCalledWith('/vault', ['a.md']);
    expect(res).toEqual({ outcomes: [{ relativePath: 'a.md', changedKeys: ['status'], deletedKeys: [] }] });
  });

  it('throws when the draft has no updates', async () => {
    await expect(call(Channels.CONVERSATION_FILE_PROPERTY_DRAFT, '/vault', { conversationId: 'c1', updates: [] }))
      .rejects.toThrow(/FILE_PROPERTY_DRAFT/);
    expect(h.applyPropertyUpdates).not.toHaveBeenCalled();
  });
});

// #1900 — CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT delegates to
// fileSourceProperties (llm/source-properties.ts), which is itself
// approval-gated (#943) — that deeper proposeWrite/approveProposal wiring
// has its own test coverage; this only verifies the handler's delegation.
describe('CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT (#1900)', () => {
  it('upserts dc:abstract and thought:tldr through fileSourceProperties', async () => {
    h.fileSourceProperties.mockResolvedValue({ changedPredicates: ['dc:abstract', 'thought:tldr'] });
    const draft = { draftId: 'sp1', conversationId: 'c1', sourceId: 'src1', abstract: 'An abstract.', tldr: 'Short version.' };

    const res = await call(Channels.CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT, '/vault', draft);

    expect(h.fileSourceProperties).toHaveBeenCalledWith('/vault', 'src1', [
      { predicate: 'dc:abstract', value: JSON.stringify('An abstract.') },
      { predicate: 'thought:tldr', value: JSON.stringify('Short version.') },
    ]);
    expect(res).toEqual({ outcome: { sourceId: 'src1', changedPredicates: ['dc:abstract', 'thought:tldr'] } });
  });

  it('throws when the draft has no sourceId', async () => {
    await expect(call(Channels.CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT, '/vault', { conversationId: 'c1', abstract: 'x' }))
      .rejects.toThrow(/FILE_SOURCE_PROPERTY_DRAFT/);
  });

  it('reports an error outcome, without calling fileSourceProperties, when neither field arrived', async () => {
    const draft = { draftId: 'sp2', conversationId: 'c1', sourceId: 'src2' };

    const res = await call(Channels.CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT, '/vault', draft);

    expect(h.fileSourceProperties).not.toHaveBeenCalled();
    expect(res).toEqual({
      outcome: { sourceId: 'src2', changedPredicates: [], error: 'neither abstract nor tldr arrived across IPC — nothing written.' },
    });
  });

  it('reports a fileSourceProperties failure on the outcome instead of throwing', async () => {
    h.fileSourceProperties.mockRejectedValue(new Error('meta.ttl write failed'));
    const draft = { draftId: 'sp3', conversationId: 'c1', sourceId: 'src3', abstract: 'x' };

    const res = await call(Channels.CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT, '/vault', draft);

    expect(res).toEqual({ outcome: { sourceId: 'src3', changedPredicates: [], error: 'meta.ttl write failed' } });
  });
});

// #1900 — CONVERSATION_RUN_COMPUTE_DRAFT and _INSERT_COMPUTE_DRAFT do NOT go
// through proposeWrite/approveProposal. "Run" is gated by the per-cell
// compute-consent guard (#1411/#1412); "Insert into note" is a plain
// user-directed write. Each is tested against its own real trust mechanism.
describe('CONVERSATION_RUN_COMPUTE_DRAFT (#1900)', () => {
  it('refuses unconsented code without running it', async () => {
    h.computeConsentGuard.mockReturnValue({ ok: false, error: 'not approved to run' });
    const input = { draft: { draftId: 'd1', conversationId: 'c1', language: 'python', code: 'print(1)' } };

    const res = await call(Channels.CONVERSATION_RUN_COMPUTE_DRAFT, '/vault', input);

    expect(res).toEqual({ result: { ok: false, error: 'not approved to run' } });
    expect(h.runCell).not.toHaveBeenCalled();
    expect(h.proposeWrite).not.toHaveBeenCalled();
  });

  it('runs consented code, records execution + graph provenance, and appends context to the conversation', async () => {
    h.computeConsentGuard.mockReturnValue(null);
    h.runCell.mockResolvedValue({ ok: true, output: { type: 'text', value: '2' } });
    h.formatComputeResultAsContext.mockReturnValue('```python\n1+1\n```\n=> 2');
    const draft = { draftId: 'd2', conversationId: 'c1', language: 'python', code: '1+1' };

    const res = await call(Channels.CONVERSATION_RUN_COMPUTE_DRAFT, '/vault', { draft });

    expect(h.runCell).toHaveBeenCalledWith('python', '1+1', { rootPath: '/vault' });
    expect(h.recordExecution).toHaveBeenCalledWith(expect.objectContaining({
      project: '/vault', language: 'python', code: '1+1', provenance: 'conversation',
    }));
    expect(h.appendMessage).toHaveBeenCalledWith('/vault', 'c1', 'user', expect.stringContaining('2'));
    expect(h.recordComputeProposalRun).toHaveBeenCalled();
    expect(res).toEqual({ result: { ok: true, output: { type: 'text', value: '2' } } });
    // Not the approval-engine path — no proposal filed for a compute run.
    expect(h.proposeWrite).not.toHaveBeenCalled();
  });

  it('runs editedCode instead of the draft\'s own code when provided', async () => {
    h.computeConsentGuard.mockReturnValue(null);
    h.runCell.mockResolvedValue({ ok: true, output: { type: 'text', value: '4' } });
    const draft = { draftId: 'd3', conversationId: 'c1', language: 'python', code: '1+1' };

    await call(Channels.CONVERSATION_RUN_COMPUTE_DRAFT, '/vault', { draft, editedCode: '2+2' });

    expect(h.runCell).toHaveBeenCalledWith('python', '2+2', { rootPath: '/vault' });
  });

  it('throws when the draft is missing language or code', async () => {
    await expect(call(Channels.CONVERSATION_RUN_COMPUTE_DRAFT, '/vault', { draft: { draftId: 'd4', conversationId: 'c1' } }))
      .rejects.toThrow(/RUN_COMPUTE_DRAFT/);
  });

  // Both of these are best-effort side records of a run that already
  // happened — a failure logs and the result still comes back, rather than
  // losing a real compute result over a conversation-log or graph hiccup.
  it('still returns the result when appending to the conversation log fails', async () => {
    h.computeConsentGuard.mockReturnValue(null);
    h.runCell.mockResolvedValue({ ok: true, output: { type: 'text', value: '2' } });
    h.appendMessage.mockRejectedValue(new Error('conversation store unavailable'));
    const draft = { draftId: 'd5', conversationId: 'c1', language: 'python', code: '1+1' };

    const res = await call(Channels.CONVERSATION_RUN_COMPUTE_DRAFT, '/vault', { draft });

    expect(res).toEqual({ result: { ok: true, output: { type: 'text', value: '2' } } });
  });

  it('still returns the result when recording the ComputeProposal in the graph fails', async () => {
    h.computeConsentGuard.mockReturnValue(null);
    h.runCell.mockResolvedValue({ ok: true, output: { type: 'text', value: '2' } });
    h.recordComputeProposalRun.mockImplementation(() => { throw new Error('graph not ready'); });
    const draft = { draftId: 'd6', conversationId: 'c1', language: 'python', code: '1+1' };

    const res = await call(Channels.CONVERSATION_RUN_COMPUTE_DRAFT, '/vault', { draft });

    expect(res).toEqual({ result: { ok: true, output: { type: 'text', value: '2' } } });
  });
});

describe('CONVERSATION_INSERT_COMPUTE_DRAFT (#1900)', () => {
  it('appends the compute block to an existing note at the given destination', async () => {
    h.readFile.mockResolvedValue('# Existing\n');
    h.buildComputeProposalNoteBlock.mockReturnValue('```python\n1+1\n```');
    const draft = { draftId: 'ic1', conversationId: 'c1', language: 'python', code: '1+1' };

    const res = await call(Channels.CONVERSATION_INSERT_COMPUTE_DRAFT, '/vault', { draft, destinationPath: 'notes/x.md' });

    expect(h.writeAndReindex).toHaveBeenCalledWith(
      '/vault', 'notes/x.md', expect.stringContaining('# Existing'), expect.anything(),
    );
    expect(res).toEqual({ destinationPath: 'notes/x.md' });
    // Not the approval-engine path — a direct, user-directed write.
    expect(h.proposeWrite).not.toHaveBeenCalled();
  });

  it('defaults the destination and starts a fresh note when none exists yet', async () => {
    h.readFile.mockRejectedValue(new Error('ENOENT'));
    h.buildComputeProposalNoteBlock.mockReturnValue('```python\n1+1\n```');
    const draft = { draftId: 'ic2', conversationId: 'convo-9', language: 'python', code: '1+1' };

    const res = await call(Channels.CONVERSATION_INSERT_COMPUTE_DRAFT, '/vault', { draft });

    expect(res).toEqual({ destinationPath: 'notes/inbox/conversations/convo-9.md' });
    expect(h.writeAndReindex).toHaveBeenCalledWith(
      '/vault', 'notes/inbox/conversations/convo-9.md', expect.stringContaining('# Conversation: convo-9'), expect.anything(),
    );
  });

  it('throws when the draft is missing language or code', async () => {
    await expect(call(Channels.CONVERSATION_INSERT_COMPUTE_DRAFT, '/vault', { draft: { draftId: 'ic3', conversationId: 'c1' } }))
      .rejects.toThrow(/INSERT_COMPUTE_DRAFT/);
  });
});
