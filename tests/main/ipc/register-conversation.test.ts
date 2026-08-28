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
    complete: vi.fn(),
    appendMessage: vi.fn(),
    load: vi.fn(),
    setContainerId: vi.fn(),
    archive: vi.fn(),
    create: vi.fn(),
    replaceMessages: vi.fn(),
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
vi.mock('../../../src/main/llm/index', () => ({
  completeWithTools: h.completeWithTools,
  complete: h.complete,
}));

// Conversation persistence.
vi.mock('../../../src/main/llm/conversation', () => ({
  appendMessage: h.appendMessage,
  setContainerId: h.setContainerId,
  load: h.load,
  archive: h.archive,
  create: h.create,
  replaceMessages: h.replaceMessages,
  DEFAULT_UI_STATE: { visible: false, height: 320, activeTabId: null },
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
const compact = h.handlers.get(Channels.CONVERSATION_COMPACT)!;

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

// ── What the system prompt promises the user (#1817) ───────────────────────
// A user was told, in detail, that their notes had been silently corrupted and
// that they should go hand-repair the files. The model had run grep in the web
// tools' code sandbox — which cannot see the thoughtbase — and reasoned from
// the garbage it got back. These pin the two sentences that exist to stop that,
// asserted on the prompt that actually reaches the model rather than on the
// constant, so a change to how the prompt is assembled fails here too.

describe('conversation system prompt guardrails (#1817)', () => {
  async function systemPrompt(): Promise<string> {
    h.completeWithTools.mockResolvedValue(completion('reply'));
    await send(evt, 'conv-1', 'hello');
    return (h.completeWithTools.mock.calls[0]![0] as { system: string }).system;
  }

  it('says the code sandbox cannot see the thoughtbase', async () => {
    const system = await systemPrompt();
    expect(system).toMatch(/sandbox/i);
    expect(system).toMatch(/cannot see the thoughtbase/i);
    // And that it isn't the user's machine either — the sandbox's filesystem
    // is what the model mistook for the user's notes.
    expect(system).toMatch(/NOT on the user's machine/i);
  });

  it('names the tools that can actually read the notes', async () => {
    const system = await systemPrompt();
    for (const tool of ['read_note', 'grep_notes', 'search_notes', 'query_graph']) {
      expect(system, `${tool} should be named as a real way to read the thoughtbase`).toContain(tool);
    }
  });

  it('forbids claiming the notes are damaged without having seen it', async () => {
    const system = await systemPrompt();
    expect(system).toMatch(/never tell the user their notes are damaged/i);
    // The reason matters as much as the rule: acting on a false alarm is what
    // destroys work, and nothing here can undo a user's hand-edits.
    expect(system).toMatch(/hand-repair/i);
  });
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
      // Every conversation call now names the project the CALLING WINDOW has
       // open (#1743), instead of reaching module state the last-opened project
       // owned — the bug that made two thoughtbases share one conversation store.
       '/root', 'conv-1', 'assistant', 'assistant reply',
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
    expect(h.setContainerId).toHaveBeenCalledWith('/root', 'conv-1', undefined, undefined);
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
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: ['Filed.md'], rewrittenPaths: [] });

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

  // #1895 — this used to assert `applied: true` here, pinning the bug the
  // issue reports: fileAndApprove used to hardcode `applied: true` even when
  // proposeWrite returned nothing to approve. It must read false.
  it('does not approve when proposeWrite files nothing (empty bundle), and reports applied: false', async () => {
    h.proposeWrite.mockResolvedValue(null);

    const draft = {
      draftId: 'd2',
      conversationId: 'conv-1',
      payloads: [{ kind: 'note', relativePath: 'y.md', content: 'c' }],
      note: 'n',
    };
    const res = await fileDraft(evt, draft);

    expect(h.approveProposal).not.toHaveBeenCalled();
    expect(res).toEqual({ proposalUri: null, applied: false, filedPaths: [] });
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
    h.approveProposal.mockResolvedValue({ ok: true, filedPaths: [], rewrittenPaths: [] });
  });

  it('files one folder-delete payload per SELECTED folder, in one proposal', async () => {
    const res = await fileDeleteDraft(evt, folderDraft, ['a', 'b']);

    expect(h.proposeWrite).toHaveBeenCalledTimes(1);
    expect(h.proposeWrite.mock.calls[0]![1]).toMatchObject({
      operationType: 'note_delete',
      payloads: [
        { kind: 'folder-delete', path: 'a' },
        { kind: 'folder-delete', path: 'b' },
      ],
    });
    expect(h.approveProposal).toHaveBeenCalledWith(expect.anything(), 'proposal:del');
    // #1895 — applied now reflects the real approveProposal result via
    // fileAndApprove, not a hardcoded true.
    expect(res).toEqual({ proposalUri: 'proposal:del', applied: true });
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
    expect(h.load).toHaveBeenCalledWith('/root', 'conv-1');
    expect(h.completeWithTools).toHaveBeenCalledTimes(1);
    expect(h.appendMessage).toHaveBeenCalledTimes(1);
    expect(h.appendMessage).toHaveBeenCalledWith(
      '/root', 'conv-1', 'assistant', 'second attempt', expect.anything(),
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

// ── /compact refuses a truncated summary (#1811) ───────────────────────────
// Compaction archives the original and makes the summary the model's entire
// memory of it. Every other truncation in the app is worth keeping and
// labelling; this one is worth refusing, because a half-written summary
// silently becomes the conversation's past.

describe('CONVERSATION_COMPACT with a truncated summary (#1811)', () => {
  /** A conversation long enough for planCompaction to have something to do. */
  function longConversation() {
    return {
      ...CONV,
      status: 'active',
      messages: Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}`,
        timestamp: 't',
      })),
    };
  }

  it('reports instead of compacting, and leaves the conversation alone', async () => {
    h.load.mockResolvedValue(longConversation());
    h.complete.mockImplementation(async (_prompt: string, opts: { onTruncated?: () => void }) => {
      opts.onTruncated?.();
      return 'A summary that stops mid-';
    });

    const result = await compact(evt, 'conv-1') as { compacted: boolean; reason?: string };

    expect(result.compacted).toBe(false);
    expect(result.reason).toMatch(/length limit/i);
    // The original must survive: no archive, no replacement conversation.
    expect(h.archive).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.replaceMessages).not.toHaveBeenCalled();
  });

  it('compacts normally when the summary came back whole', async () => {
    h.load.mockResolvedValue(longConversation());
    h.complete.mockResolvedValue('A complete summary.');
    h.create.mockResolvedValue({ ...CONV, id: 'conv-2' });
    h.replaceMessages.mockResolvedValue({ ...CONV, id: 'conv-2' });

    const result = await compact(evt, 'conv-1') as { compacted: boolean };

    expect(result.compacted).toBe(true);
    expect(h.archive).toHaveBeenCalledWith('/root', 'conv-1');
  });
});
