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
 *   - SEND runs inside the graph LLM context (withLLMContext), even on error;
 *   - SEND retries once on the API's `container_id is required` 400;
 *   - aborting a send rejects a pending `ask_user` prompt;
 *   - a conversation draft is filed via `proposeWrite` and auto-approved.
 *
 * A regression that dropped the `withLLMContext` wrap, the retry, or the
 * proposeWrite/approve dispatch now fails here instead of silently at runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Channels } from '../../../src/shared/channels';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const fakeWin = { id: 1, isDestroyed: () => false, webContents: { send: vi.fn() }, once: vi.fn(), removeListener: vi.fn() };
  return {
    handlers,
    fakeWin,
    withLLMContext: vi.fn((fn: () => unknown) => fn()),
    completeWithTools: vi.fn(),
    complete: vi.fn(),
    appendMessage: vi.fn(),
    load: vi.fn(),
    setContainerId: vi.fn(),
    archive: vi.fn(),
    create: vi.fn(),
    replaceMessages: vi.fn(),
    setTitle: vi.fn(),
    listAll: vi.fn(async () => []),
    setBranchOutcome: vi.fn(async () => null),
    getSettings: vi.fn(),
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
  broadcastApplied: vi.fn(),
}));

// graph: only the LLM-context guard is exercised here.
vi.mock('../../../src/main/graph/index', () => ({
  withLLMContext: h.withLLMContext,
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
  setTitle: h.setTitle,
  listAll: h.listAll,
  setBranchOutcome: h.setBranchOutcome,
  DEFAULT_UI_STATE: { visible: false, height: 320, activeTabId: null },
}));

// Settings — only what auto-titling reads; the rest of the module is real.
vi.mock('../../../src/main/llm/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/llm/settings')>()),
  getSettings: h.getSettings,
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
const mcpConfirmReply = h.handlers.get(Channels.CONVERSATION_MCP_CONFIRM_REPLY)!;
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

    expect(h.withLLMContext).toHaveBeenCalledTimes(1);
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
    // withLLMContext wraps the whole handler exactly once.
    expect(h.withLLMContext).toHaveBeenCalledTimes(1);
  });

  it('sends a skill\'s material in the first user turn, never in the system prompt (#2438)', async () => {
    const skillContext = '<thoughtbase-content kind="note" path="n.md">\nNOTE-BODY-CANARY\n</thoughtbase-content>';
    h.appendMessage.mockResolvedValue({
      ...CONV,
      systemPrompt: 'You summarize notes.',
      skillContext,
      messages: [
        { role: 'user', content: 'Summarize.' },
        { role: 'assistant', content: 'Done.' },
        { role: 'user', content: 'Shorter.' },
      ],
    });
    h.completeWithTools.mockResolvedValue(completion('reply'));

    await send(evt, 'conv-1', 'Shorter.');

    const params = h.completeWithTools.mock.calls[0]![0] as { system: string; messages: Array<{ role: string; content: string }> };
    expect(params.system).toContain('You summarize notes.');
    expect(params.system).not.toContain('NOTE-BODY-CANARY');
    expect(params.messages[0]).toEqual({ role: 'user', content: `${skillContext}\n\nSummarize.` });
    expect(params.messages.slice(1).map((m) => m.content)).toEqual(['Done.', 'Shorter.']);
  });

  it('retries once, stripping the container id, on the API container_id 400', async () => {
    h.completeWithTools
      .mockRejectedValueOnce(new Error('400 {"error":"container_id is required when there are pending tool uses"}'))
      .mockResolvedValueOnce(completion('recovered'));

    await send(evt, 'conv-1', 'hello');

    expect(h.completeWithTools).toHaveBeenCalledTimes(2);
    // The stale/absent container id is cleared before the retry.
    expect(h.setContainerId).toHaveBeenCalledWith('/root', 'conv-1', undefined, undefined);
    expect(h.withLLMContext).toHaveBeenCalledTimes(1);
  });

  it('re-throws a non-container error but still exits the LLM context', async () => {
    h.completeWithTools.mockRejectedValue(new Error('some other API failure'));

    await expect(send(evt, 'conv-1', 'hello')).rejects.toThrow('some other API failure');

    expect(h.completeWithTools).toHaveBeenCalledTimes(1); // no retry for a non-container error
    expect(h.withLLMContext).toHaveBeenCalledTimes(1);    // ran (and rejected) exactly once
  });

  it('rejects a pending ask_user prompt when the send is aborted', async () => {
    // The model calls ask_user, then a cancel arrives before the user answers.
    h.completeWithTools.mockImplementation(async ({ callbacks }: { callbacks: { askUser: (q: { question: string }) => Promise<string> } }) => {
      const answer = callbacks.askUser({ question: 'pick one?' });
      cancel(evt, 'conv-1'); // abort mid-question
      await expect(answer).rejects.toThrow('aborted');
      return completion('unwound');
    });

    await expect(send(evt, 'conv-1', 'hello')).resolves.toBeDefined();
  });

  // ── mcp_call confirmation (#2439) ─────────────────────────────────────
  type Confirm = (p: { serverName: string; toolName: string; argsJson: string }) => Promise<unknown>;
  const PROMPT = { serverName: 'slack', toolName: 'post_message', argsJson: '{}' };
  const lastConfirmRequestId = (): string => {
    const call = h.fakeWin.webContents.send.mock.calls.filter((c) => c[0] === Channels.CONVERSATION_MCP_CONFIRM).at(-1)!;
    return (call[1] as { requestId: string }).requestId;
  };

  it('Allow on the reply channel resolves the pending card, with "Don\'t ask again"', async () => {
    h.completeWithTools.mockImplementation(async ({ callbacks }: { callbacks: { confirmMcpCall: Confirm } }) => {
      const decision = callbacks.confirmMcpCall(PROMPT);
      await mcpConfirmReply(evt, lastConfirmRequestId(), true, true);
      await expect(decision).resolves.toEqual({ allow: true, remember: true });
      return completion('ok');
    });
    await expect(send(evt, 'conv-1', 'hello')).resolves.toBeDefined();
  });

  it('anything but a literal true is a Deny', async () => {
    h.completeWithTools.mockImplementation(async ({ callbacks }: { callbacks: { confirmMcpCall: Confirm } }) => {
      const decision = callbacks.confirmMcpCall(PROMPT);
      await mcpConfirmReply(evt, lastConfirmRequestId(), 'yes', true);
      await expect(decision).resolves.toEqual({ allow: false, reason: 'denied' });
      return completion('ok');
    });
    await expect(send(evt, 'conv-1', 'hello')).resolves.toBeDefined();
  });

  it('a reply from another window, or for an unknown id, is ignored', async () => {
    h.completeWithTools.mockImplementation(async ({ callbacks }: { callbacks: { confirmMcpCall: Confirm } }) => {
      let settled = false;
      const decision = callbacks.confirmMcpCall(PROMPT).then((d) => { settled = true; return d; });
      const id = lastConfirmRequestId();
      await mcpConfirmReply(evt, 'no-such-id', true, false);
      h.fakeWin.id = 2;
      try {
        await mcpConfirmReply(evt, id, true, false);
      } finally {
        h.fakeWin.id = 1;
      }
      await Promise.resolve();
      expect(settled).toBe(false);
      cancel(evt, 'conv-1');
      await expect(decision).resolves.toEqual({ allow: false, reason: 'cancelled' });
      return completion('ok');
    });
    await expect(send(evt, 'conv-1', 'hello')).resolves.toBeDefined();
  });

  it('stopping the turn resolves a pending card as cancelled (never hangs, never allows)', async () => {
    h.completeWithTools.mockImplementation(async ({ callbacks }: { callbacks: { confirmMcpCall: Confirm } }) => {
      const decision = callbacks.confirmMcpCall(PROMPT);
      cancel(evt, 'conv-1');
      await expect(decision).resolves.toEqual({ allow: false, reason: 'cancelled' });
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

    expect(h.withLLMContext).toHaveBeenCalledTimes(1);
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

// ── The stream tail is never lost (#2219) ──────────────────────────────────
// Chunk coalescing buffers stream text for up to STREAM_COALESCE_MS, which
// creates a failure the send-per-chunk code could not have: text still sitting
// in the buffer when the turn ends. The registrar's `finally` around the
// completion is the only thing that ships it, and a truncated final chunk is a
// silently corrupted message — the user sees a reply that stops mid-sentence
// with no error at all. These assert the flush on each exit path.
//
// Deliberately NOT timer-driven: no fake timers are installed in this file and
// the window is 100ms, so nothing these tests observe can have been delivered
// by the timer expiring. Anything that arrives, arrived because of the flush.
describe('stream tail flush (#2219)', () => {
  const streamed = (): string =>
    h.fakeWin.webContents.send.mock.calls
      .filter((c) => c[0] === Channels.CONVERSATION_STREAM)
      .map((c) => (c[1] as { text: string }).text)
      .join('');

  it('ships text buffered when the turn completes normally', async () => {
    h.completeWithTools.mockImplementation(async (params: unknown) => {
      const { callbacks } = params as { callbacks: { onChunk: (s: string) => void } };
      callbacks.onChunk('the final ');
      callbacks.onChunk('sentence.');
      return completion('the final sentence.');
    });

    await send(evt, 'conv-1', 'hello');

    expect(streamed()).toBe('the final sentence.');
  });

  it('ships the partial text when the turn throws', async () => {
    // The failure card renders exactly this text (#1804). Without the flush a
    // turn that died three paragraphs in would show two.
    h.completeWithTools.mockImplementation(async (params: unknown) => {
      const { callbacks } = params as { callbacks: { onChunk: (s: string) => void } };
      callbacks.onChunk('three paragraphs of real output');
      throw new Error('rate limited');
    });

    await expect(send(evt, 'conv-1', 'hello')).rejects.toThrow('rate limited');
    expect(streamed()).toBe('three paragraphs of real output');
  });

  it('flushes before the reply, while the store is still streaming', async () => {
    // Ordering matters as much as delivery: the renderer store drops any chunk
    // arriving after `send()` resolves, because its `finally` clears
    // `streamedChunks` and sets `streaming = false`. A flush that happened
    // after the reply would deliver into a closed window of attention.
    let sentByAppendTime = -1;
    h.completeWithTools.mockImplementation(async (params: unknown) => {
      const { callbacks } = params as { callbacks: { onChunk: (s: string) => void } };
      callbacks.onChunk('tail text');
      return completion('tail text');
    });
    h.appendMessage.mockImplementation(async () => {
      sentByAppendTime = streamed().length;
      return CONV;
    });

    await send(evt, 'conv-1', 'hello');

    // appendMessage runs AFTER the completion's `finally`, so the tail is
    // already on the wire by then — and therefore well before the reply.
    expect(sentByAppendTime).toBe('tail text'.length);
  });
});


// ── Conversation titles ─────────────────────────────────────────────────────
// After the first exchange, one background call on the provider's cheap tier
// names the conversation; a rename is a `user` title auto-titling never touches.

describe('conversation titles', () => {
  const setTitleHandler = h.handlers.get(Channels.CONVERSATION_SET_TITLE)!;
  const firstExchange = {
    ...CONV,
    messages: [{ role: 'user', content: 'how were mandolins tuned in 1700?' }, { role: 'assistant', content: 'In fifths, mostly.' }],
  };
  const titleEvents = () => h.fakeWin.webContents.send.mock.calls.filter((c) => c[0] === Channels.CONVERSATION_TITLE_CHANGED);

  it('renames through setTitle as a user title', async () => {
    h.setTitle.mockResolvedValue({ conversation: { ...CONV, title: 'Trip', titleSource: 'user' }, changed: true });
    const out = await setTitleHandler(evt, 'conv-1', 'Trip');
    expect(h.setTitle).toHaveBeenCalledWith('/root', 'conv-1', 'Trip', 'user');
    expect(out).toMatchObject({ title: 'Trip' });
  });

  it('titles the conversation after its first reply, on the cheap tier, and tells the window', async () => {
    h.appendMessage.mockResolvedValue({ ...firstExchange, model: 'claude-opus-5-5' });
    h.getSettings.mockResolvedValue({ model: 'claude-opus-5', providers: {} });
    h.complete.mockResolvedValue('"Mandolin tuning in 1700."');
    h.setTitle.mockResolvedValue({ conversation: firstExchange, changed: true });
    h.completeWithTools.mockResolvedValue(completion('In fifths, mostly.'));

    await send(evt, 'conv-1', 'how were mandolins tuned in 1700?');
    await vi.waitFor(() => expect(titleEvents()).toHaveLength(1));

    expect(h.complete.mock.calls[0]![1]).toMatchObject({ model: 'claude-sonnet-5', effort: 'low' });
    expect(h.setTitle).toHaveBeenCalledWith('/root', 'conv-1', 'Mandolin tuning in 1700', 'auto');
    expect(titleEvents()[0]![1]).toEqual({ conversationId: 'conv-1', title: 'Mandolin tuning in 1700' });
  });

  it('does nothing when auto-titling is off, or after the first exchange', async () => {
    h.completeWithTools.mockResolvedValue(completion('reply'));
    h.appendMessage.mockResolvedValue(firstExchange);
    h.getSettings.mockResolvedValue({ model: 'claude-opus-5', providers: {}, autoTitleConversations: false });
    await send(evt, 'conv-1', 'hello');
    h.appendMessage.mockResolvedValue({ ...firstExchange, messages: [...firstExchange.messages, ...firstExchange.messages] });
    h.getSettings.mockResolvedValue({ model: 'claude-opus-5', providers: {} });
    await send(evt, 'conv-1', 'hello');
    await new Promise((r) => setTimeout(r, 20));
    expect(h.complete).not.toHaveBeenCalled();
    expect(titleEvents()).toHaveLength(0);
  });
});

// ── Several conversations at once (#2969) ────────────────────────────────
describe('turns keyed by conversation, not window (#2969)', () => {
  type Params = { toolContext: { conversationId: string }; callbacks: { signal: AbortSignal; onChunk: (s: string) => void; askUser: (q: { question: string }) => Promise<string> } };
  /** Start a turn whose completion waits until released; hands back its callbacks. */
  const startTurns = (ids: string[]) => {
    const running = new Map<string, { params: Params; release: () => void }>();
    h.completeWithTools.mockImplementation((params: Params) => new Promise((resolve, reject) => {
      const id = params.toolContext.conversationId;
      running.set(id, { params, release: () => resolve(completion(`reply for ${id}`)) });
      params.callbacks.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    // Started one after another, each once the one before has reached the
    // model, and then all in flight together. (Started in the same tick,
    // vitest's loader never resolves the second lazy import of the mocked
    // LLM client while the first is pending; Node's own loader shares it.)
    const sends: Promise<unknown>[] = [];
    const launching = (async () => {
      for (const id of ids) {
        const sent = send(evt, id, 'hello') as Promise<unknown>;
        sent.catch(() => undefined);
        sends.push(sent);
        for (let i = 0; i < 200 && !running.has(id); i++) await new Promise((r) => setTimeout(r, 0));
      }
    })();
    const started = () => launching;
    return { running, sends, started };
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  beforeEach(async () => {
    h.getSettings.mockResolvedValue({ autoTitleConversations: false });
    // The handler imports the LLM client lazily; load it once up front, so two
    // turns starting together don't both race the first (mocked) import.
    await import('../../../src/main/llm/index');
  });

  it('two conversations in one window run at once; stopping one leaves the other running', async () => {
    const { running, sends, started } = startTurns(['conv-a', 'conv-b']);
    await started();
    expect([...running.keys()].sort()).toEqual(['conv-a', 'conv-b']);

    cancel(evt, 'conv-a');
    await expect(sends[0]).rejects.toThrow('aborted');
    expect(running.get('conv-b')!.params.callbacks.signal.aborted).toBe(false);

    running.get('conv-b')!.release();
    await expect(sends[1]).resolves.toBeDefined();
  });

  it('streamed text names its conversation', async () => {
    const { running, sends, started } = startTurns(['conv-a', 'conv-b']);
    await started();
    running.get('conv-a')!.params.callbacks.onChunk('for A');
    running.get('conv-b')!.params.callbacks.onChunk('for B');
    running.get('conv-a')!.release();
    running.get('conv-b')!.release();
    await Promise.all(sends);
    const chunks = h.fakeWin.webContents.send.mock.calls.filter((c) => c[0] === Channels.CONVERSATION_STREAM).map((c) => c[1]);
    expect(chunks).toEqual(expect.arrayContaining([
      { conversationId: 'conv-a', text: 'for A' },
      { conversationId: 'conv-b', text: 'for B' },
    ]));
  });

  it('a second turn for a conversation already answering is refused, and the first runs on', async () => {
    const { running, sends, started } = startTurns(['conv-a']);
    await started();
    await expect(send(evt, 'conv-a', 'again')).rejects.toThrow(/already answering/);
    expect(running.get('conv-a')!.params.callbacks.signal.aborted).toBe(false);
    running.get('conv-a')!.release();
    await expect(sends[0]).resolves.toBeDefined();
  });

  it('stopping one conversation rejects only its own pending question', async () => {
    const { running, sends, started } = startTurns(['conv-a', 'conv-b']);
    await started();
    const qa = running.get('conv-a')!.params.callbacks.askUser({ question: 'a?' });
    let bSettled = false;
    // Settled either way is what's watched; the rejection when conv-b stops below is expected.
    void running.get('conv-b')!.params.callbacks.askUser({ question: 'b?' }).finally(() => { bSettled = true; }).catch(() => {});
    cancel(evt, 'conv-a');
    await expect(qa).rejects.toThrow('aborted');
    await expect(sends[0]).rejects.toThrow();
    await settle();
    expect(bSettled).toBe(false);
    cancel(evt, 'conv-b');
    await expect(sends[1]).rejects.toThrow();
  });

  it('Stop from another window, or for a conversation not running, does nothing', async () => {
    const { running, sends, started } = startTurns(['conv-a']);
    await started();
    cancel(evt, 'conv-zzz');
    h.fakeWin.id = 2;
    try { cancel(evt, 'conv-a'); } finally { h.fakeWin.id = 1; }
    expect(running.get('conv-a')!.params.callbacks.signal.aborted).toBe(false);
    running.get('conv-a')!.release();
    await expect(sends[0]).resolves.toBeDefined();
  });

  // ── Branches (#2970) ──
  const branchOf = (id: string, parentId: string) => ({ id, status: 'active', branch: { parentId, atMessage: 0, context: 'summary' } });

  it('stopping a parent stops its branches, and theirs, and no other conversation (#2970)', async () => {
    h.listAll.mockResolvedValue([{ id: 'conv-a', status: 'active' }, branchOf('conv-b', 'conv-a'), branchOf('conv-c', 'conv-b'), { id: 'conv-d', status: 'active' }]);
    const { running, sends, started } = startTurns(['conv-a', 'conv-b', 'conv-c', 'conv-d']);
    await started();
    await cancel(evt, 'conv-a');
    for (const i of [0, 1, 2]) await expect(sends[i]).rejects.toThrow('aborted');
    expect(running.get('conv-d')!.params.callbacks.signal.aborted).toBe(false);
    running.get('conv-d')!.release();
    await expect(sends[3]).resolves.toBeDefined();
  });

  it('stopping a branch stops only it (#2970)', async () => {
    h.listAll.mockResolvedValue([{ id: 'conv-a', status: 'active' }, branchOf('conv-b', 'conv-a')]);
    const { running, sends, started } = startTurns(['conv-a', 'conv-b']);
    await started();
    await cancel(evt, 'conv-b');
    await expect(sends[1]).rejects.toThrow('aborted');
    expect(running.get('conv-a')!.params.callbacks.signal.aborted).toBe(false);
    running.get('conv-a')!.release();
    await expect(sends[0]).resolves.toBeDefined();
  });

  it('a branch records how its turn ended: done, stopped, failed (#2970)', async () => {
    const branch = { ...CONV, id: 'conv-b', branch: { parentId: 'conv-a', atMessage: 0, context: 'summary' } };
    h.appendMessage.mockResolvedValue(branch);
    h.setBranchOutcome.mockImplementation(async (_r: string, _id: string, outcome: string) => ({ ...branch, branch: { ...branch.branch, outcome } }));
    h.completeWithTools.mockResolvedValueOnce(completion('ok'));
    const done = await send(evt, 'conv-b', 'go') as { branch: { outcome: string } };
    expect(done.branch.outcome).toBe('done');
    h.completeWithTools.mockRejectedValueOnce(new Error('overloaded'));
    await expect(send(evt, 'conv-b', 'go')).rejects.toThrow('overloaded');
    const { sends, started } = startTurns(['conv-b']);
    await started();
    await cancel(evt, 'conv-b');
    await expect(sends[0]).rejects.toThrow('aborted');
    expect(h.setBranchOutcome.mock.calls.map((c) => c[2])).toEqual(['done', 'failed', 'stopped']);
    // An ordinary conversation records nothing.
    h.appendMessage.mockResolvedValue(CONV);
    h.completeWithTools.mockResolvedValueOnce(completion('ok'));
    await send(evt, 'conv-1', 'hi');
    expect(h.setBranchOutcome).toHaveBeenCalledTimes(3);
  });

  it('closing the window stops every turn it started', async () => {
    const { sends, started } = startTurns(['conv-a', 'conv-b']);
    await started();
    const closers = h.fakeWin.once.mock.calls.filter((c) => c[0] === 'closed').map((c) => c[1] as () => void);
    for (const close of closers) close();
    await expect(sends[0]).rejects.toThrow('aborted');
    await expect(sends[1]).rejects.toThrow('aborted');
  });

  it('a turn waiting for a slot tells the window, by conversation', async () => {
    h.completeWithTools.mockImplementation(async (params: { callbacks: { onWait: (s: unknown) => void } }) => {
      params.callbacks.onWait({ kind: 'queued', ahead: 0 });
      params.callbacks.onWait(null);
      return completion('ok');
    });
    await send(evt, 'conv-1', 'hello');
    const waits = h.fakeWin.webContents.send.mock.calls.filter((c) => c[0] === Channels.CONVERSATION_WAIT).map((c) => c[1]);
    expect(waits).toEqual([
      { conversationId: 'conv-1', status: { kind: 'queued', ahead: 0 } },
      { conversationId: 'conv-1', status: null },
    ]);
  });
});

// ── Branch + archive handlers (#2970) ─────────────────────────────────────
describe('branch and archive handlers (#2970)', () => {
  it('CONVERSATION_BRANCH forks in main, linking the branch to its parent', async () => {
    h.load.mockResolvedValue({ ...CONV, status: 'active', messages: [{ role: 'user', content: 'hello', timestamp: 't' }] });
    h.create.mockImplementation(async (_r: string, bundle: unknown, _t: unknown, opts: unknown, seed: unknown) => ({ id: 'conv-2', contextBundle: bundle, opts, seed }));
    const made = await h.handlers.get(Channels.CONVERSATION_BRANCH)!(evt, 'conv-1', { title: 'Risks', context: 'full', instructions: 'List them.' }) as { seed: { branch: unknown; title: string; messages: { content: string }[] }; opts: { model: string } };
    expect(made.seed.branch).toEqual({ parentId: 'conv-1', atMessage: 1, context: 'full' });
    expect(made.seed.title).toBe('Risks');
    expect(made.seed.messages.map((m) => m.content)).toEqual(['hello', 'List them.']);
    expect(made.opts.model).toBe('claude-x');
  });

  it('CONVERSATION_ARCHIVE archives the conversation and its active branches', async () => {
    h.archive.mockImplementation(async (_r: string, id: string) => ({ id, status: 'archived' }));
    h.listAll.mockResolvedValue([
      { id: 'conv-1', status: 'active' },
      { id: 'conv-2', status: 'active', branch: { parentId: 'conv-1', atMessage: 0, context: 'summary' } },
      { id: 'conv-3', status: 'archived', branch: { parentId: 'conv-1', atMessage: 0, context: 'summary' } },
      { id: 'conv-4', status: 'active' },
    ]);
    const out = await h.handlers.get(Channels.CONVERSATION_ARCHIVE)!(evt, 'conv-1') as { id: string };
    expect(out.id).toBe('conv-1');
    expect(h.archive.mock.calls.map((c) => c[1])).toEqual(['conv-1', 'conv-2']);
  });
});

// ── fork (#2971) ─────────────────────────────────────────────────────────
describe('a fork from a conversation turn (#2971)', () => {
  it('runs each branch as a turn of its own, with no UI callbacks or fork, and rolls its cost into the reply', async () => {
    h.getSettings.mockResolvedValue({ autoTitleConversations: false });
    h.complete.mockResolvedValue('The user asked something.');
    h.setBranchOutcome.mockResolvedValue(null);
    const parent = { ...CONV, status: 'active', messages: [{ role: 'user', content: 'hello', timestamp: 't' }] };
    const branch = { ...CONV, id: 'conv-b', status: 'active', branch: { parentId: 'conv-1', atMessage: 1, context: 'summary' }, messages: [{ role: 'user', content: 'opening', timestamp: 't' }] };
    h.load.mockImplementation(async (_r: string, id: string) => (id === 'conv-b' ? branch : parent));
    h.create.mockResolvedValue(branch);
    h.appendMessage.mockImplementation(async (_r: string, id: string, role: string, content: string) =>
      id === 'conv-b'
        ? { ...branch, messages: [...branch.messages, { role, content, timestamp: 't', costUSD: 0.02 }] }
        : { ...parent, messages: [...parent.messages, { role, content, timestamp: 't' }] });

    let forkOutcome: unknown;
    let branchCallbacks: Record<string, unknown> | undefined;
    h.completeWithTools.mockImplementation(async (params: { toolContext: { conversationId: string }; callbacks: Record<string, unknown> & { runBranches?: (s: unknown[]) => Promise<unknown> } }) => {
      if (params.toolContext.conversationId === 'conv-1') {
        forkOutcome = await params.callbacks.runBranches!([{ title: 'Risks', instructions: 'List the risks.' }]);
        return completion('parent reply');
      }
      branchCallbacks = params.callbacks;
      return completion('branch answer');
    });

    await send(evt, 'conv-1', 'go');

    expect(forkOutcome).toMatchObject({ ok: true, results: [{ title: 'Risks', status: 'done', answer: 'branch answer', conversationId: 'conv-b' }] });
    // The branch forked from the parent, its opening the shared summary plus its instructions.
    const seed = h.create.mock.calls[0]![4] as { branch: unknown; messages: { content: string }[] };
    expect(seed.branch).toEqual({ parentId: 'conv-1', atMessage: 1, context: 'summary' });
    expect(seed.messages[0]!.content).toMatch(/The user asked something\.[\s\S]*List the risks\./);
    // Its turn streams, stops, drafts, asks and confirms — all routed to the
    // parent (#2973) — but can't fork or offer a drafted extension.
    expect(branchCallbacks).not.toHaveProperty('runBranches');
    expect(branchCallbacks).not.toHaveProperty('offerExtensionDraft');
    for (const key of ['onChunk', 'onWait', 'signal', 'onDraft', 'onClaimsDraft', 'onNoteBodyDraft', 'askUser', 'confirmMcpCall']) {
      expect(branchCallbacks, key).toHaveProperty(key);
    }
    expect(h.setBranchOutcome).toHaveBeenCalledWith('/root', 'conv-b', 'done');
    // The parent's reply carries what the branch cost.
    const parentAppend = h.appendMessage.mock.calls.find((c) => c[1] === 'conv-1' && c[2] === 'assistant')!;
    expect(parentAppend[4]).toMatchObject({ addCostUSD: 0.02 });

    // The window got the fork's progress for its card (#2972): one fork id, under the parent, ending joined.
    const forkEvents = h.fakeWin.webContents.send.mock.calls.filter((c) => c[0] === Channels.CONVERSATION_FORK).map((c) => c[1] as { conversationId: string; forkId: string; joined: boolean; branches: { state: string; conversationId: string }[] });
    expect(forkEvents.map((p) => [p.branches[0]!.state, p.joined])).toEqual([['starting', false], ['running', false], ['done', false], ['done', true]]);
    expect(new Set(forkEvents.map((p) => p.forkId)).size).toBe(1);
    expect(forkEvents.every((p) => p.conversationId === 'conv-1')).toBe(true);
    expect(forkEvents.at(-1)!.branches[0]!.conversationId).toBe('conv-b');
  });

  it('a branch\'s draft and question reach the window labelled for its parent (#2973)', async () => {
    h.getSettings.mockResolvedValue({ autoTitleConversations: false });
    h.complete.mockResolvedValue('Summary.');
    h.setBranchOutcome.mockResolvedValue(null);
    const parent = { ...CONV, status: 'active', messages: [{ role: 'user', content: 'hello', timestamp: 't' }] };
    const branch = { ...CONV, id: 'conv-b', title: 'Risks', status: 'active', branch: { parentId: 'conv-1', atMessage: 1, context: 'summary' }, messages: [{ role: 'user', content: 'opening', timestamp: 't' }] };
    h.load.mockImplementation(async (_r: string, id: string) => (id === 'conv-b' ? branch : parent));
    h.create.mockResolvedValue(branch);
    h.appendMessage.mockImplementation(async (_r: string, id: string, role: string, content: string) =>
      ({ ...(id === 'conv-b' ? branch : parent), messages: [{ role, content, timestamp: 't' }] }));
    h.completeWithTools.mockImplementation(async (params: { toolContext: { conversationId: string }; callbacks: Record<string, (...a: unknown[]) => unknown> & { runBranches?: (s: unknown[]) => Promise<unknown> } }) => {
      if (params.toolContext.conversationId === 'conv-1') {
        await params.callbacks.runBranches!([{ title: 'Risks', instructions: 'List the risks.' }]);
        return completion('parent reply');
      }
      params.callbacks.onDraft!({ draftId: 'd-1', conversationId: 'conv-b', createdAt: 't', note: 'n', payloads: [] });
      const asked = params.callbacks.askUser!({ question: 'Which risk first?' }) as Promise<string>;
      await vi.waitFor(() => expect(h.fakeWin.webContents.send.mock.calls.some((c) => c[0] === Channels.CONVERSATION_ASK_USER)).toBe(true));
      const q = h.fakeWin.webContents.send.mock.calls.find((c) => c[0] === Channels.CONVERSATION_ASK_USER)![1] as { questionId: string };
      await h.handlers.get(Channels.CONVERSATION_ASK_USER_REPLY)!(evt, q.questionId, 'cost');
      expect(await asked).toBe('cost');
      return completion('branch answer');
    });

    await send(evt, 'conv-1', 'go');

    const label = { parentId: 'conv-1', title: 'Risks' };
    const draft = h.fakeWin.webContents.send.mock.calls.find((c) => c[0] === Channels.CONVERSATION_DRAFT)![1];
    expect(draft).toMatchObject({ draftId: 'd-1', conversationId: 'conv-b', branch: label });
    const question = h.fakeWin.webContents.send.mock.calls.find((c) => c[0] === Channels.CONVERSATION_ASK_USER)![1];
    expect(question).toMatchObject({ conversationId: 'conv-b', question: 'Which risk first?', branch: label });
  });
});
