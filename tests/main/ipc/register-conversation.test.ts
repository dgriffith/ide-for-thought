/**
 * @vitest-environment node
 *
 * Main-process coverage for the conversation IPC handlers (#1612 / QA C1).
 *
 * `register-conversation.ts` is the LLM↔graph boundary the trust model governs
 * (CLAUDE.md), yet had NO main-process test: the `CONVERSATION_SEND` streaming /
 * abort / 400-retry path and the draft-filing handlers were unverified. This
 * drives the real handlers against mocked collaborators (the LLM client, the
 * conversation store, the approval engine, the graph LLM-context guard) and
 * asserts the trust-critical behavior:
 *
 *   - SEND runs inside the graph LLM context (enter/exit), and exits even on error;
 *   - SEND retries once on the API's `container_id is required` 400;
 *   - aborting a send rejects a pending `ask_user` prompt;
 *   - a conversation draft is filed via `proposeWrite` and auto-approved.
 *
 * A regression that dropped the `enterLLMContext` wrap, the retry, or the
 * proposeWrite/approve dispatch now fails here instead of silently at runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Channels } from '../../../src/shared/channels';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const fakeWin = { id: 1, isDestroyed: () => false, webContents: { send: vi.fn() } };
  return {
    handlers,
    fakeWin,
    enterLLMContext: vi.fn(),
    exitLLMContext: vi.fn(),
    completeWithTools: vi.fn(),
    appendMessage: vi.fn(),
    load: vi.fn(),
    setContainerId: vi.fn(),
    proposeWrite: vi.fn(),
    approveProposal: vi.fn(),
  };
});

// electron: capture every handler; hand back a fake window.
vi.mock('electron', () => {
  const noop = (): undefined => undefined;
  class FakeWindow {
    static fromWebContents() { return h.fakeWin; }
    static fromId() { return h.fakeWin; }
    static getFocusedWindow() { return null; }
    static getAllWindows() { return []; }
  }
  return {
    ipcMain: {
      handle: (c: string, fn: Handler) => { h.handlers.set(c, fn); },
      on: (c: string, fn: Handler) => { h.handlers.set(c, fn); },
      removeHandler: noop,
    },
    Notification: class { show(): void {} },
    app: { getPath: () => '/tmp', getName: () => 'minerva', getVersion: () => '0.0.0', on: noop },
    BrowserWindow: FakeWindow,
    dialog: {}, Menu: {}, shell: {}, nativeTheme: { on: noop }, clipboard: {}, net: {},
  };
});

// helpers: give the raw handlers a window + rootPath, and make the withRootPath*
// wrappers inject a fixed rootPath so the wrapped handlers run.
vi.mock('../../../src/main/ipc/helpers', () => ({
  winFromEvent: () => h.fakeWin,
  rootPathFromEvent: () => '/root',
  withRootPath: (fn: (rp: string, ...a: unknown[]) => unknown) => (_e: unknown, ...a: unknown[]) => fn('/root', ...a),
  withRootPathOr: (_fallback: unknown, fn: (rp: string, ...a: unknown[]) => unknown) => (_e: unknown, ...a: unknown[]) => fn('/root', ...a),
  withRootPathWin: (fn: (rp: string, win: unknown, ...a: unknown[]) => unknown) => (_e: unknown, ...a: unknown[]) => fn('/root', h.fakeWin, ...a),
  reindexFile: vi.fn(),
  persistIndexes: vi.fn(),
  hooks: {},
}));

// graph: only the LLM-context guard is exercised here.
vi.mock('../../../src/main/graph/index', () => ({
  enterLLMContext: h.enterLLMContext,
  exitLLMContext: h.exitLLMContext,
  withLLMContext: (fn: () => unknown) => fn(),
}));

// The LLM client (dynamically imported inside the handler).
vi.mock('../../../src/main/llm/index', () => ({ completeWithTools: h.completeWithTools }));

// Conversation persistence.
vi.mock('../../../src/main/llm/conversation', () => ({
  appendMessage: h.appendMessage,
  setContainerId: h.setContainerId,
  load: h.load,
}));

// Approval engine — the trust gate.
vi.mock('../../../src/main/llm/approval', () => ({
  proposeWrite: h.proposeWrite,
  approveProposal: h.approveProposal,
}));

// The thoughtbase-doc prompt block reads from disk — stub it out.
vi.mock('../../../src/main/llm/thoughtbase-doc', () => ({
  readThoughtbaseDoc: async () => null,
  thoughtbaseDocPromptBlock: () => '',
}));

import { registerConversation } from '../../../src/main/ipc/register-conversation';
import { registerConversationDrafts } from '../../../src/main/ipc/register-conversation-drafts';

registerConversation();
registerConversationDrafts();

const evt = { sender: {} };
const send = h.handlers.get(Channels.CONVERSATION_SEND)!;
const cancel = h.handlers.get(Channels.CONVERSATION_CANCEL)!;
const retry = h.handlers.get(Channels.CONVERSATION_RETRY)!;
const fileDraft = h.handlers.get(Channels.CONVERSATION_FILE_DRAFT)!;
const fileDeleteDraft = h.handlers.get(Channels.CONVERSATION_FILE_DELETE_DRAFT)!;

const CONV = {
  id: 'conv-1',
  messages: [{ role: 'user', content: 'hello' }],
  systemPrompt: undefined,
  contextBundle: {},
  model: 'claude-x',
  effort: 'medium',
  webEnabled: undefined,
  containerId: undefined,
};

function seedConversation(): void {
  h.load.mockResolvedValue(CONV);
  h.appendMessage.mockResolvedValue({
    id: 'conv-1',
    messages: [{ role: 'user', content: 'hello' }],
    systemPrompt: undefined,
    contextBundle: {},
    model: 'claude-x',
    effort: 'medium',
    webEnabled: undefined,
    containerId: undefined,
  });
}

const completion = (text: string) => ({ text, citations: [], usage: { input: 1, output: 1 }, usageModel: 'claude-x' });

beforeEach(() => {
  vi.clearAllMocks();
  seedConversation();
});

describe('CONVERSATION_SEND (#1612)', () => {
  it('registers the handler', () => {
    expect(send).toBeDefined();
    expect(cancel).toBeDefined();
    expect(fileDraft).toBeDefined();
  });

  it('runs inside the graph LLM context, calls the LLM once, and appends the assistant reply', async () => {
    h.completeWithTools.mockResolvedValue(completion('assistant reply'));

    await send(evt, 'conv-1', 'hello');

    expect(h.enterLLMContext).toHaveBeenCalledTimes(1);
    expect(h.completeWithTools).toHaveBeenCalledTimes(1);
    expect(h.completeWithTools.mock.calls[0]![0]).toMatchObject({
      toolContext: { rootPath: '/root', conversationId: 'conv-1' },
    });
    // The assistant turn is persisted with the LLM result.
    expect(h.appendMessage).toHaveBeenCalledWith(
      'conv-1', 'assistant', 'assistant reply',
      expect.objectContaining({ usageModel: 'claude-x' }),
    );
    // Context released in the finally.
    expect(h.exitLLMContext).toHaveBeenCalledTimes(1);
  });

  it('retries once, stripping the container id, on the API container_id 400', async () => {
    h.completeWithTools
      .mockRejectedValueOnce(new Error('400 {"error":"container_id is required when there are pending tool uses"}'))
      .mockResolvedValueOnce(completion('recovered'));

    await send(evt, 'conv-1', 'hello');

    expect(h.completeWithTools).toHaveBeenCalledTimes(2);
    // The stale/absent container id is cleared before the retry.
    expect(h.setContainerId).toHaveBeenCalledWith('conv-1', undefined, undefined);
    expect(h.exitLLMContext).toHaveBeenCalledTimes(1);
  });

  it('re-throws a non-container error but still exits the LLM context', async () => {
    h.completeWithTools.mockRejectedValue(new Error('some other API failure'));

    await expect(send(evt, 'conv-1', 'hello')).rejects.toThrow('some other API failure');

    expect(h.completeWithTools).toHaveBeenCalledTimes(1); // no retry for a non-container error
    expect(h.exitLLMContext).toHaveBeenCalledTimes(1);    // finally still ran
  });

  it('rejects a pending ask_user prompt when the send is aborted', async () => {
    // The model calls ask_user, then a cancel arrives before the user answers.
    h.completeWithTools.mockImplementation(async ({ callbacks }: { callbacks: { askUser: (q: { question: string }) => Promise<string> } }) => {
      const answer = callbacks.askUser({ question: 'pick one?' });
      cancel(evt); // abort mid-question
      await expect(answer).rejects.toThrow('aborted');
      return completion('unwound');
    });

    await expect(send(evt, 'conv-1', 'hello')).resolves.toBeDefined();
  });
});

describe('CONVERSATION_FILE_DRAFT — propose + auto-approve (#1612)', () => {
  it('files the draft through the approval engine and auto-approves it', async () => {
    h.proposeWrite.mockResolvedValue({ uri: 'proposal:abc' });
    h.approveProposal.mockResolvedValue({ filedPaths: ['Filed.md'], rewrittenPaths: [] });

    const draft = {
      draftId: 'd1',
      conversationId: 'conv-1',
      payloads: [{ kind: 'note', relativePath: 'x.md', content: 'c' }],
      note: 'a note',
    };
    const res = await fileDraft(evt, draft);

    // Filed via proposeWrite with the conversation provenance…
    expect(h.proposeWrite).toHaveBeenCalledTimes(1);
    expect(h.proposeWrite.mock.calls[0]![1]).toMatchObject({
      operationType: 'component_creation',
      payloads: draft.payloads,
      note: 'a note',
      conversationUri: 'https://minerva.dev/ontology/thought#conversation/conv-1',
      proposedBy: 'llm:conversation:conv-1',
    });
    // …then auto-approved (the user already accepted the inline card).
    expect(h.approveProposal).toHaveBeenCalledWith(expect.anything(), 'proposal:abc');
    expect(res).toEqual({ proposalUri: 'proposal:abc', applied: true, filedPaths: ['Filed.md'] });
  });

  it('does not approve when proposeWrite files nothing (empty bundle)', async () => {
    h.proposeWrite.mockResolvedValue(null);

    const draft = {
      draftId: 'd2',
      conversationId: 'conv-1',
      payloads: [{ kind: 'note', relativePath: 'y.md', content: 'c' }],
      note: 'n',
    };
    const res = await fileDraft(evt, draft);

    expect(h.approveProposal).not.toHaveBeenCalled();
    expect(res).toEqual({ proposalUri: null, applied: true, filedPaths: [] });
  });
});

describe('CONVERSATION_FILE_DELETE_DRAFT — the selection UNIT differs by kind (#1778)', () => {
  const folderDraft = {
    draftId: 'd3',
    conversationId: 'conv-1',
    note: 'Delete 2 folders',
    items: [
      { path: 'a/one.md', title: 'One', inbound: [], folder: 'a' },
      { path: 'b/two.md', title: 'Two', inbound: [], folder: 'b' },
    ],
    warnings: [],
    folderPaths: ['a', 'b'],
  };

  beforeEach(() => {
    h.proposeWrite.mockResolvedValue({ uri: 'proposal:del' });
    h.approveProposal.mockResolvedValue({ filedPaths: [], rewrittenPaths: [] });
  });

  it('files one folder-delete payload per SELECTED folder, in one proposal', async () => {
    await fileDeleteDraft(evt, folderDraft, ['a', 'b']);

    expect(h.proposeWrite).toHaveBeenCalledTimes(1);
    expect(h.proposeWrite.mock.calls[0]![1]).toMatchObject({
      operationType: 'note_delete',
      payloads: [
        { kind: 'folder-delete', path: 'a' },
        { kind: 'folder-delete', path: 'b' },
      ],
    });
    expect(h.approveProposal).toHaveBeenCalledWith(expect.anything(), 'proposal:del');
  });

  it('honours a partial folder selection', async () => {
    await fileDeleteDraft(evt, folderDraft, ['b']);
    expect(h.proposeWrite.mock.calls[0]![1]).toMatchObject({
      payloads: [{ kind: 'folder-delete', path: 'b' }],
    });
  });

  it('deletes NOTHING when the selection names no folder from the draft', async () => {
    // e.g. note paths sent for a folder draft — never widen to "all folders".
    const res = await fileDeleteDraft(evt, folderDraft, ['a/one.md']);
    expect(h.proposeWrite).not.toHaveBeenCalled();
    expect(res).toEqual({ proposalUri: null, applied: false });
  });

  it('still files per-note deletes for a plain note draft', async () => {
    const noteDraft = {
      draftId: 'd4',
      conversationId: 'conv-1',
      note: 'Delete 2 notes',
      items: [
        { path: 'x.md', title: 'X', inbound: [] },
        { path: 'y.md', title: 'Y', inbound: [] },
      ],
      warnings: [],
    };
    await fileDeleteDraft(evt, noteDraft, ['x.md']);
    expect(h.proposeWrite.mock.calls[0]![1]).toMatchObject({
      payloads: [{ kind: 'note-delete', path: 'x.md' }],
    });
  });
});

// ── Retry after a failed turn (#1804) ──────────────────────────────────────
// Main appends the user's message BEFORE calling the model, so a failed turn
// leaves it persisted. Retry therefore has to re-run the completion over the
// existing history — going back through SEND would file the same user turn a
// second time, which is the bug this handler exists to avoid.

describe('CONVERSATION_RETRY (#1804)', () => {
  it('registers the handler', () => {
    expect(retry).toBeDefined();
  });

  it('re-runs the completion WITHOUT re-appending the user message', async () => {
    h.completeWithTools.mockResolvedValue(completion('second attempt'));

    await retry(evt, 'conv-1');

    // Loaded, not appended-to: exactly one appendMessage call, the assistant's.
    expect(h.load).toHaveBeenCalledWith('conv-1');
    expect(h.completeWithTools).toHaveBeenCalledTimes(1);
    expect(h.appendMessage).toHaveBeenCalledTimes(1);
    expect(h.appendMessage).toHaveBeenCalledWith(
      'conv-1', 'assistant', 'second attempt', expect.anything(),
    );
  });

  it('runs inside the graph LLM context, and exits even when the model throws', async () => {
    h.completeWithTools.mockRejectedValue(new Error('overloaded'));

    await expect(retry(evt, 'conv-1')).rejects.toThrow('overloaded');

    expect(h.enterLLMContext).toHaveBeenCalledTimes(1);
    expect(h.exitLLMContext).toHaveBeenCalledTimes(1);
  });

  it('throws rather than silently no-opping when the conversation is gone', async () => {
    h.load.mockResolvedValue(null);
    await expect(retry(evt, 'conv-1')).rejects.toThrow(/not found/i);
    expect(h.completeWithTools).not.toHaveBeenCalled();
  });
});
