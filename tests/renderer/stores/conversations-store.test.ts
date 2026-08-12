/**
 * Complementary coverage for the conversations singleton store
 * (`src/renderer/lib/stores/conversations.svelte.ts`). The four sibling
 * `conversation-*.test.ts` files already cover `/clear`, `/compact`, the
 * uniform draft-subscription plumbing, and the propose_note_body flow; this
 * file fills in the rest of the public surface WITHOUT duplicating them:
 *
 *   - lifecycle: init / reset / openConversationTab / closeTab
 *   - the send() turn (happy path, missing-key path, no-op guards)
 *   - cancel / setModel / setEffort / setComposer / UI state (show/hide/
 *     toggle/setHeight/setActiveTab)
 *   - ask_user round-trip (onAskUser subscription → answerQuestion)
 *   - EVERY remaining draft-filing path (the Trust Principle spine): each
 *     `propose_*` draft arrives over its subscription, then Approve routes
 *     through the matching `api.conversations.file*` (the approval engine)
 *     and mutates the store's draft/result state, while Discard writes
 *     nothing. Covers fileDraft, fileSourceDraft, filePropertyDraft,
 *     fileClaimsDraft, fileSourcePropertyDraft, fileRefactorDraft,
 *     fileReorgDraft, fileDeleteDraft, and the compute Run/Insert paths.
 *
 * Drives the real runes store with a mocked api client that captures every
 * subscription callback (so drafts can be injected) and records every
 * mutation call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation } from '../../../src/shared/types';
import type { AskUserRequest } from '../../../src/shared/conversation-tools';

type Cb = (payload: { draftId: string; conversationId: string }) => void;

const h = vi.hoisted(() => {
  const cbs: Record<string, (arg: unknown) => void> = {};
  const cap = (name: string) => vi.fn((cb: (arg: unknown) => void) => { cbs[name] = cb; });
  let nextId = 1;
  const makeConv = (
    contextBundle: unknown,
    triggerNodeUri?: string,
    options?: { systemPrompt?: string; model?: string },
  ): Conversation => ({
    id: `conv-${nextId++}`,
    contextBundle: contextBundle as Conversation['contextBundle'],
    triggerNodeUri,
    messages: [],
    status: 'active',
    startedAt: 't',
    ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options?.model ? { model: options.model } : {}),
  });
  const api = {
    conversations: {
      // subscriptions — captured so tests can inject drafts / questions.
      onStream: cap('onStream'),
      onDraft: cap('onDraft'),
      onSourceDraft: cap('onSourceDraft'),
      onPropertyDraft: cap('onPropertyDraft'),
      onSourcePropertyDraft: cap('onSourcePropertyDraft'),
      onClaimsDraft: cap('onClaimsDraft'),
      onComputeDraft: cap('onComputeDraft'),
      onRefactorDraft: cap('onRefactorDraft'),
      onReorgDraft: cap('onReorgDraft'),
      onDeleteDraft: cap('onDeleteDraft'),
      onNoteBodyDraft: cap('onNoteBodyDraft'),
      onAskUser: cap('onAskUser'),
      // lifecycle / persistence
      loadUIState: vi.fn().mockResolvedValue({ visible: false, height: 320, activeTabId: null }),
      saveUIState: vi.fn().mockResolvedValue(undefined),
      listActive: vi.fn().mockResolvedValue([] as Conversation[]),
      create: vi.fn(async (bundle: unknown, trigger?: string, options?: { systemPrompt?: string; model?: string }) =>
        makeConv(bundle, trigger, options)),
      load: vi.fn(async (_id: string) => null as Conversation | null),
      archive: vi.fn().mockResolvedValue(undefined),
      // turn
      send: vi.fn().mockResolvedValue(undefined),
      retry: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn(),
      setEffort: vi.fn(),
      askUserReply: vi.fn().mockResolvedValue(undefined),
      // draft-filing (the approval-engine hand-off)
      fileDraft: vi.fn().mockResolvedValue({ proposalUri: 'urn:p', applied: true, filedPaths: ['notes/a.md'] }),
      fileSourceDraft: vi.fn().mockResolvedValue({ outcomes: [{ input: { url: 'https://x' }, sourceId: 's1', title: 'X' }] }),
      filePropertyDraft: vi.fn().mockResolvedValue({ outcomes: [{ relativePath: 'notes/a.md', changedKeys: ['status'], deletedKeys: [] }] }),
      fileSourcePropertyDraft: vi.fn().mockResolvedValue({ outcome: { sourceId: 's1', changedPredicates: ['thought:tldr'] } }),
      fileClaimsDraft: vi.fn().mockResolvedValue({ outcome: { sourceId: 's1', claimPaths: ['notes/claim.md'], excerptIds: ['e1'] } }),
      fileRefactorDraft: vi.fn().mockResolvedValue(undefined),
      fileReorgDraft: vi.fn().mockResolvedValue(undefined),
      fileDeleteDraft: vi.fn().mockResolvedValue(undefined),
      fileNoteBodyDraft: vi.fn().mockResolvedValue({ proposalUri: 'urn:p', applied: true }),
      // compute
      runComputeDraft: vi.fn().mockResolvedValue({ result: { ok: true, format: 'text', value: '42' } }),
      insertComputeDraft: vi.fn().mockResolvedValue({ destinationPath: 'notes/inbox/out.md' }),
    },
  };
  // Neutralize the eyes-on-code consent gate so runComputeDraft's IPC path is
  // what we exercise, not the dialog. Tests flip it to false to cover decline.
  const ensureComputeConsent = vi.fn().mockResolvedValue(true);
  return { api, cbs, ensureComputeConsent };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/compute/run-cell-with-trust', () => ({ ensureComputeConsent: h.ensureComputeConsent }));

const ensureComputeConsent = h.ensureComputeConsent;

import { getConversationsStore } from '../../../src/renderer/lib/stores/conversations.svelte';
import { missingApiKeyMessage, llmFailureMessage } from '../../../src/shared/llm-errors';

const store = getConversationsStore();
const conv = () => h.api.conversations;

/** Open a fresh freeform tab and return it (already the active tab). */
async function freshTab() {
  await store.openFreeform('notes/origin.md');
  return store.activeTab!;
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureComputeConsent.mockResolvedValue(true);
});

// ────────────────────────────── lifecycle ──────────────────────────────

describe('init / reset', () => {
  it('init restores tabs from listActive and honors persisted height + active tab (but launches hidden)', async () => {
    const active: Conversation[] = [
      { id: 'lc-1', contextBundle: {}, messages: [], status: 'active', startedAt: 't' },
      { id: 'lc-2', contextBundle: {}, messages: [], status: 'active', startedAt: 't' },
    ];
    conv().loadUIState.mockResolvedValueOnce({ visible: true, height: 500, activeTabId: 'lc-2' });
    conv().listActive.mockResolvedValueOnce(active);

    await store.init();

    expect(conv().loadUIState).toHaveBeenCalledTimes(1);
    expect(conv().listActive).toHaveBeenCalledTimes(1);
    expect(store.initialized).toBe(true);
    expect(store.tabs.map((t) => t.id)).toEqual(expect.arrayContaining(['lc-1', 'lc-2']));
    expect(store.height).toBe(500);
    expect(store.activeTabId).toBe('lc-2');
    // Persisted `visible:true` is deliberately ignored — panel launches hidden.
    expect(store.visible).toBe(false);
  });

  it('init is idempotent — a second call does not re-query', async () => {
    await store.init();
    expect(conv().listActive).not.toHaveBeenCalled(); // already initialized from the prior test
  });

  it('reset re-initializes from the new project and falls back to the first tab', async () => {
    conv().loadUIState.mockResolvedValueOnce({ visible: false, height: 333, activeTabId: null });
    conv().listActive.mockResolvedValueOnce([
      { id: 'r-1', contextBundle: {}, messages: [], status: 'active', startedAt: 't' },
    ]);

    await store.reset();

    expect(store.tabs.map((t) => t.id)).toEqual(['r-1']);
    expect(store.height).toBe(333);
    expect(store.activeTabId).toBe('r-1');
  });

  it('init falls back to safe defaults when loadUIState rejects', async () => {
    conv().loadUIState.mockRejectedValueOnce(new Error('disk gone'));
    await store.reset(); // reset flips initialized off then calls init()
    expect(store.tabs).toEqual([]);
    expect(store.activeTabId).toBeNull();
    expect(store.height).toBe(320);
  });
});

// ─────────────────────────── tab lifecycle ───────────────────────────

describe('openConversationTab / closeTab', () => {
  it('creates a tab with system prompt + model + extraTools and auto-sends the initial message', async () => {
    conv().load.mockResolvedValueOnce({
      id: 'ignored', contextBundle: { notePath: 'notes/seed.md' },
      messages: [{ role: 'user', content: 'seed', timestamp: 't' }, { role: 'assistant', content: 'ok', timestamp: 't' }],
      status: 'active', startedAt: 't',
    });
    const tab = await store.openConversationTab({
      notePath: 'notes/seed.md',
      systemPrompt: 'SYS',
      model: 'claude-x',
      initialMessage: 'discuss this',
      extraTools: ['ask_user'],
    });

    expect(conv().create).toHaveBeenCalledWith(
      { notePath: 'notes/seed.md' },
      undefined,
      { systemPrompt: 'SYS', model: 'claude-x' },
    );
    expect(tab.extraTools).toEqual(['ask_user']);
    expect(store.tabs.some((t) => t.id === tab.id)).toBe(true);
    expect(store.activeTabId).toBe(tab.id);
    expect(store.visible).toBe(true);

    // initialMessage fired a send() carrying the template tools.
    await vi.waitFor(() => expect(conv().send).toHaveBeenCalled());
    const [id, text, , notePath, tools] = conv().send.mock.calls[0];
    expect(id).toBe(tab.id);
    expect(text).toBe('discuss this');
    expect(notePath).toBe('notes/seed.md');
    expect(tools).toEqual(['ask_user']);
  });

  it('closeTab archives the conversation and drops it from the tab list', async () => {
    const a = await freshTab();
    const b = await freshTab();
    expect(store.activeTabId).toBe(b.id);

    await store.closeTab(b.id);

    expect(conv().archive).toHaveBeenCalledWith(b.id);
    expect(store.tabs.some((t) => t.id === b.id)).toBe(false);
    // Active tab moved to a surviving neighbor.
    expect(store.activeTabId).toBe(a.id);
  });

  it('closeTab still drops the tab locally when archive fails', async () => {
    const t = await freshTab();
    conv().archive.mockRejectedValueOnce(new Error('already archived'));
    await store.closeTab(t.id);
    expect(store.tabs.some((x) => x.id === t.id)).toBe(false);
  });
});

// ───────────────────────────── send() turn ─────────────────────────────

describe('send()', () => {
  it('echoes the user turn, routes through api.conversations.send, then reloads the canonical transcript', async () => {
    const tab = await freshTab();
    const reloaded: Conversation = {
      id: tab.id, contextBundle: { notePath: 'notes/origin.md' },
      messages: [
        { role: 'user', content: 'hello', timestamp: 't' },
        { role: 'assistant', content: 'hi there', timestamp: 't' },
      ],
      status: 'active', startedAt: 't',
    };
    conv().load.mockResolvedValueOnce(reloaded);

    await store.send('hello', 'notes/origin.md');

    expect(conv().send).toHaveBeenCalledWith(tab.id, 'hello', undefined, 'notes/origin.md', undefined);
    expect(conv().load).toHaveBeenCalledWith(tab.id);
    // Transcript replaced with the canonical reloaded version; streaming cleared.
    expect(tab.conversation.messages.map((m) => m.content)).toEqual(['hello', 'hi there']);
    expect(tab.streaming).toBe(false);
    expect(tab.composer).toBe('');
  });

  it('surfaces an unconfigured-provider error: restores the composer, drops the optimistic turn, flips needsApiKey', async () => {
    const tab = await freshTab();
    // Built through the shared helper rather than a hardcoded string, so this
    // can't drift from the message main actually throws (#1796 follow-up).
    conv().send.mockRejectedValueOnce(new Error(missingApiKeyMessage('openai')));

    await store.send('needs a key');

    expect(store.needsApiKey).toBe(true);
    expect(tab.composer).toBe('needs a key');       // restored for retry
    expect(tab.conversation.messages).toHaveLength(0); // optimistic insert removed
    expect(tab.streaming).toBe(false);

    store.dismissApiKeyDialog();
    expect(store.needsApiKey).toBe(false);
  });

  // ── Failure reporting (#1804) ──────────────────────────────────────────
  // Everything except the unconfigured case used to end at `console.error`: the
  // spinner stopped, the streamed text was discarded, and the user's turn sat
  // un-replied with nothing to explain it.

  /** What Electron hands the renderer when a main handler throws. */
  function overIpc(mainMessage: string): Error {
    return new Error(`Error invoking remote method 'conversation:send': Error: ${mainMessage}`);
  }

  it('records a classified failure inline, keeping the user turn and the partial reply', async () => {
    const tab = await freshTab();
    conv().send.mockImplementationOnce(async () => {
      // Text streamed before the provider died — this must survive.
      tab.streamedChunks = 'The note argues that';
      throw overIpc(llmFailureMessage('overloaded', 'Anthropic is overloaded right now.', 'anthropic'));
    });

    await store.send('summarise this');

    expect(tab.failure?.kind).toBe('overloaded');
    expect(tab.failure?.message).toBe('Anthropic is overloaded right now.');
    expect(tab.failure?.retryable).toBe(true);
    expect(tab.failure?.partial).toBe('The note argues that');
    // The user's turn stays put — it's what Retry will re-run against.
    expect(tab.conversation.messages.map((m) => m.content)).toEqual(['summarise this']);
    expect(tab.composer).toBe('');
    expect(tab.streaming).toBe(false);
  });

  it('never shows the machine token to the user', async () => {
    const tab = await freshTab();
    conv().send.mockRejectedValueOnce(
      overIpc(llmFailureMessage('quota', 'Your OpenAI account is out of credit.', 'openai')),
    );

    await store.send('hello');

    expect(tab.failure?.message).toBe('Your OpenAI account is out of credit.');
    expect(tab.failure?.message).not.toContain('MINERVA_LLM_FAILURE');
    expect(tab.failure?.message).not.toContain('Error invoking remote method');
  });

  it('marks a quota failure non-retryable — retrying an empty balance helps nobody', async () => {
    const tab = await freshTab();
    conv().send.mockRejectedValueOnce(
      overIpc(llmFailureMessage('quota', 'Out of credit.', 'anthropic')),
    );
    await store.send('hello');
    expect(tab.failure?.retryable).toBe(false);
  });

  it('stays silent on a user cancellation instead of reporting it as a failure', async () => {
    const tab = await freshTab();
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    conv().send.mockRejectedValueOnce(abort);

    await store.send('never mind');

    expect(tab.failure).toBeNull();
    expect(tab.streaming).toBe(false);
  });

  it('does not mistake a provider error that merely mentions "abort" for a cancel', async () => {
    // The old check was String(e).includes('abort'), which swallowed this.
    const tab = await freshTab();
    conv().send.mockRejectedValueOnce(
      overIpc(llmFailureMessage('server', 'The request was aborted upstream (502).', 'anthropic')),
    );

    await store.send('hello');

    expect(tab.failure?.kind).toBe('server');
  });

  it('still routes an unconfigured provider to the modal, not the inline block', async () => {
    const tab = await freshTab();
    conv().send.mockRejectedValueOnce(new Error(missingApiKeyMessage('openai')));

    await store.send('needs a key');

    expect(store.needsApiKey).toBe(true);
    expect(tab.failure).toBeNull();
  });

  it('retries through CONVERSATION_RETRY so the user turn is not filed twice', async () => {
    const tab = await freshTab();
    conv().send.mockRejectedValueOnce(
      overIpc(llmFailureMessage('overloaded', 'Overloaded.', 'anthropic')),
    );
    await store.send('summarise this', 'notes/origin.md');
    expect(tab.failure?.retryable).toBe(true);

    const reloaded: Conversation = {
      id: tab.id, contextBundle: { notePath: 'notes/origin.md' },
      messages: [
        { role: 'user', content: 'summarise this', timestamp: 't' },
        { role: 'assistant', content: 'it argues X', timestamp: 't' },
      ],
      status: 'active', startedAt: 't',
    };
    conv().load.mockResolvedValueOnce(reloaded);

    await store.retryLastTurn(tab.id, 'notes/origin.md');

    // Main already persisted the user's message before the failed call, so a
    // retry must NOT go back through send() — that would file it a second time.
    expect(conv().retry).toHaveBeenCalledWith(tab.id, undefined, 'notes/origin.md', undefined);
    expect(conv().send).toHaveBeenCalledTimes(1);
    expect(tab.failure).toBeNull();
    expect(tab.conversation.messages.map((m) => m.content)).toEqual(['summarise this', 'it argues X']);
  });

  it('reports a failed retry rather than clearing the error and going quiet', async () => {
    const tab = await freshTab();
    conv().send.mockRejectedValueOnce(overIpc(llmFailureMessage('overloaded', 'Overloaded.', 'anthropic')));
    await store.send('hello');
    conv().retry.mockRejectedValueOnce(overIpc(llmFailureMessage('rate_limited', 'Rate limited.', 'anthropic')));

    await store.retryLastTurn(tab.id);

    expect(tab.failure?.kind).toBe('rate_limited');
    expect(tab.streaming).toBe(false);
  });

  it('dismissFailure clears the block', async () => {
    const tab = await freshTab();
    conv().send.mockRejectedValueOnce(overIpc(llmFailureMessage('server', 'Boom.', 'anthropic')));
    await store.send('hello');
    expect(tab.failure).not.toBeNull();

    store.dismissFailure(tab.id);
    expect(tab.failure).toBeNull();
  });

  it('no-ops on empty content and while already streaming', async () => {
    const tab = await freshTab();
    await store.send('   ');
    expect(conv().send).not.toHaveBeenCalled();

    tab.streaming = true;
    await store.send('while busy');
    expect(conv().send).not.toHaveBeenCalled();
    tab.streaming = false;
  });
});

// ───────────────────── cancel / model / effort / composer ─────────────────────

describe('cancel / setModel / setEffort / setComposer', () => {
  it('cancel routes through api and clears the streaming flags', async () => {
    const tab = await freshTab();
    tab.streaming = true;
    tab.streamedChunks = 'partial';
    await store.cancel();
    expect(conv().cancel).toHaveBeenCalledTimes(1);
    expect(tab.streaming).toBe(false);
    expect(tab.streamedChunks).toBe('');
  });

  it('setModel routes through api and swaps in the updated conversation', async () => {
    const tab = await freshTab();
    const updated: Conversation = { ...tab.conversation, model: 'claude-opus-4-8' };
    conv().setModel.mockResolvedValueOnce(updated);
    await store.setModel(tab.id, 'claude-opus-4-8');
    expect(conv().setModel).toHaveBeenCalledWith(tab.id, 'claude-opus-4-8');
    expect(tab.conversation.model).toBe('claude-opus-4-8');
  });

  it('setEffort routes through api and swaps in the updated conversation', async () => {
    const tab = await freshTab();
    const updated: Conversation = { ...tab.conversation, effort: 'high' };
    conv().setEffort.mockResolvedValueOnce(updated);
    await store.setEffort(tab.id, 'high');
    expect(conv().setEffort).toHaveBeenCalledWith(tab.id, 'high');
    expect(tab.conversation.effort).toBe('high');
  });

  it('setModel is a no-op for an unknown tab id', async () => {
    await store.setModel('no-such-tab', 'claude-x');
    expect(conv().setModel).not.toHaveBeenCalled();
  });

  it('setComposer writes onto the active tab', async () => {
    const tab = await freshTab();
    store.setComposer('half-written thought');
    expect(tab.composer).toBe('half-written thought');
  });
});

// ─────────────────────── ask_user round-trip ───────────────────────

describe('ask_user (onAskUser → answerQuestion)', () => {
  it('surfaces a pending question and answerQuestion replies through api + clears it', async () => {
    const tab = await freshTab();
    const req: AskUserRequest = { questionId: 'q1', conversationId: tab.id, question: 'Proceed?' };
    (h.cbs.onAskUser as (r: AskUserRequest) => void)(req);
    expect(tab.pendingQuestion).toEqual(req);

    await store.answerQuestion(tab.id, 'yes');
    expect(conv().askUserReply).toHaveBeenCalledWith('q1', 'yes');
    expect(tab.pendingQuestion).toBeNull();
  });

  it('answers empty when the question targets a tab that no longer exists', async () => {
    await freshTab();
    const req: AskUserRequest = { questionId: 'q-ghost', conversationId: 'no-such-tab', question: '?' };
    (h.cbs.onAskUser as (r: AskUserRequest) => void)(req);
    expect(conv().askUserReply).toHaveBeenCalledWith('q-ghost', '');
  });
});

// ─────────────────── UI state (show/hide/toggle/height/active) ───────────────────

describe('UI state', () => {
  it('show / hide / toggle move visibility and persist', async () => {
    store.hide();
    expect(store.visible).toBe(false);
    store.show();
    expect(store.visible).toBe(true);
    store.toggle();
    expect(store.visible).toBe(false);
    await vi.waitFor(() => expect(conv().saveUIState).toHaveBeenCalled());
  });

  it('setHeight clamps to the sane range', () => {
    store.setHeight(50);   // below MIN_PANEL_HEIGHT (120)
    expect(store.height).toBe(120);
    store.setHeight(9999); // above MAX_PANEL_HEIGHT (1200)
    expect(store.height).toBe(1200);
    store.setHeight(400);
    expect(store.height).toBe(400);
  });

  it('setActiveTab switches the active tab', async () => {
    const a = await freshTab();
    const b = await freshTab();
    store.setActiveTab(a.id);
    expect(store.activeTabId).toBe(a.id);
    store.setActiveTab(b.id);
    expect(store.activeTabId).toBe(b.id);
  });
});

// ══════════════════ Trust Principle: draft filing (LLM proposes → human files) ══════════════════

describe('propose_notes draft (fileDraft)', () => {
  it('Approve files through the approval engine and replaces the card with a Filed: summary', async () => {
    const tab = await freshTab();
    (h.cbs.onDraft as Cb)({ draftId: 'd1', conversationId: tab.id });
    expect(tab.drafts.map((d) => d.draftId)).toEqual(['d1']);

    const result = await store.approveDraft(tab.id, tab.drafts[0]!);

    expect(conv().fileDraft).toHaveBeenCalledTimes(1);
    expect(result.filedPaths).toEqual(['notes/a.md']);
    expect(tab.drafts).toHaveLength(0);
    expect(tab.noteDraftResults['d1']!.filedPaths).toEqual(['notes/a.md']);
  });

  it('reports a failed Approve instead of dropping it, and leaves the card in place', async () => {
    // Every approve*Draft used to `await api.conversations.file*(…)` bare, so a
    // rejection became an unhandled promise rejection: the card stayed, no
    // result line appeared, and nothing said the write had failed (#1804).
    const tab = await freshTab();
    (h.cbs.onDraft as Cb)({ draftId: 'd3', conversationId: tab.id });
    conv().fileDraft.mockRejectedValueOnce(new Error('EACCES: permission denied'));

    const result = await store.approveDraft(tab.id, tab.drafts[0]!);

    expect(result.filedPaths).toEqual([]);
    expect(tab.failure?.message).toContain("Couldn't apply that change");
    expect(tab.failure?.message).toContain('EACCES');
    // Not retryable: re-firing a write blind is how you half-apply a bundle.
    expect(tab.failure?.retryable).toBe(false);
    // The card survives so the user can approve again deliberately.
    expect(tab.drafts.map((d) => d.draftId)).toEqual(['d3']);
    expect(tab.noteDraftResults['d3']).toBeUndefined();
  });

  it('Discard removes the card without writing anything', async () => {
    const tab = await freshTab();
    (h.cbs.onDraft as Cb)({ draftId: 'd2', conversationId: tab.id });
    store.discardDraft(tab.id, 'd2');
    expect(tab.drafts).toHaveLength(0);
    expect(conv().fileDraft).not.toHaveBeenCalled();
  });
});

describe('propose_sources draft (fileSourceDraft)', () => {
  it('Approve ingests through the approval engine, drops the card, stashes outcomes; dismiss clears them', async () => {
    const tab = await freshTab();
    (h.cbs.onSourceDraft as Cb)({ draftId: 's-d1', conversationId: tab.id });

    await store.approveSourceDraft(tab.id, tab.sourceDrafts[0]!);

    expect(conv().fileSourceDraft).toHaveBeenCalledTimes(1);
    expect(tab.sourceDrafts).toHaveLength(0);
    expect(tab.sourceDraftResults['s-d1']!.outcomes[0]!.sourceId).toBe('s1');

    store.dismissSourceDraftResult(tab.id, 's-d1');
    expect(tab.sourceDraftResults['s-d1']).toBeUndefined();
  });

  it('Discard removes the card without ingesting', async () => {
    const tab = await freshTab();
    (h.cbs.onSourceDraft as Cb)({ draftId: 's-d2', conversationId: tab.id });
    store.discardSourceDraft(tab.id, 's-d2');
    expect(tab.sourceDrafts).toHaveLength(0);
    expect(conv().fileSourceDraft).not.toHaveBeenCalled();
  });
});

describe('set_properties draft (filePropertyDraft)', () => {
  it('Approve files a plain (proxy-shed) payload and records the per-note outcome', async () => {
    const tab = await freshTab();
    (h.cbs.onPropertyDraft as Cb)({ draftId: 'p-d1', conversationId: tab.id });
    // give the draft realistic nested payload so the JSON round-trip is exercised.
    (tab.propertyDrafts[0] as unknown as { updates: unknown[] }).updates = [
      { relativePath: 'notes/a.md', properties: { status: 'done' } },
    ];

    await store.approvePropertyDraft(tab.id, tab.propertyDrafts[0]!);

    expect(conv().filePropertyDraft).toHaveBeenCalledTimes(1);
    const [sent] = conv().filePropertyDraft.mock.calls[0];
    expect(sent.updates[0].properties.status).toBe('done'); // keys survived serialization
    expect(tab.propertyDrafts).toHaveLength(0);
    expect(tab.propertyDraftResults['p-d1']!.outcomes[0]!.changedKeys).toEqual(['status']);
  });

  it('Discard removes the card without writing', async () => {
    const tab = await freshTab();
    (h.cbs.onPropertyDraft as Cb)({ draftId: 'p-d2', conversationId: tab.id });
    store.discardPropertyDraft(tab.id, 'p-d2');
    expect(tab.propertyDrafts).toHaveLength(0);
    expect(conv().filePropertyDraft).not.toHaveBeenCalled();
  });
});

describe('propose_source_properties draft (fileSourcePropertyDraft)', () => {
  it('Approve upserts meta.ttl through the approval engine and records the outcome', async () => {
    const tab = await freshTab();
    (h.cbs.onSourcePropertyDraft as Cb)({ draftId: 'sp-d1', conversationId: tab.id });

    await store.approveSourcePropertyDraft(tab.id, tab.sourcePropertyDrafts[0]!);

    expect(conv().fileSourcePropertyDraft).toHaveBeenCalledTimes(1);
    expect(tab.sourcePropertyDrafts).toHaveLength(0);
    expect(tab.sourcePropertyDraftResults['sp-d1']!.outcome.changedPredicates).toEqual(['thought:tldr']);
  });

  it('Discard removes the card without writing', async () => {
    const tab = await freshTab();
    (h.cbs.onSourcePropertyDraft as Cb)({ draftId: 'sp-d2', conversationId: tab.id });
    store.discardSourcePropertyDraft(tab.id, 'sp-d2');
    expect(tab.sourcePropertyDrafts).toHaveLength(0);
    expect(conv().fileSourcePropertyDraft).not.toHaveBeenCalled();
  });
});

describe('propose_claims draft (fileClaimsDraft)', () => {
  it('Approve files claims + excerpts through the approval engine and records the outcome', async () => {
    const tab = await freshTab();
    (h.cbs.onClaimsDraft as Cb)({ draftId: 'c-d1', conversationId: tab.id });

    await store.approveClaimsDraft(tab.id, tab.claimsDrafts[0]!);

    expect(conv().fileClaimsDraft).toHaveBeenCalledTimes(1);
    expect(tab.claimsDrafts).toHaveLength(0);
    expect(tab.claimsDraftResults['c-d1']!.outcome.claimPaths).toEqual(['notes/claim.md']);
  });

  it('Discard removes the card without writing', async () => {
    const tab = await freshTab();
    (h.cbs.onClaimsDraft as Cb)({ draftId: 'c-d2', conversationId: tab.id });
    store.discardClaimsDraft(tab.id, 'c-d2');
    expect(tab.claimsDrafts).toHaveLength(0);
    expect(conv().fileClaimsDraft).not.toHaveBeenCalled();
  });
});

describe('propose_note_rename/move draft (fileRefactorDraft)', () => {
  it('Approve files the move through the approval engine and drops the card', async () => {
    const tab = await freshTab();
    (h.cbs.onRefactorDraft as Cb)({ draftId: 'rf-d1', conversationId: tab.id });
    await store.approveRefactorDraft(tab.id, tab.refactorDrafts[0]!);
    expect(conv().fileRefactorDraft).toHaveBeenCalledTimes(1);
    expect(tab.refactorDrafts).toHaveLength(0);
  });

  it('Discard removes the card without moving', async () => {
    const tab = await freshTab();
    (h.cbs.onRefactorDraft as Cb)({ draftId: 'rf-d2', conversationId: tab.id });
    store.discardRefactorDraft(tab.id, 'rf-d2');
    expect(tab.refactorDrafts).toHaveLength(0);
    expect(conv().fileRefactorDraft).not.toHaveBeenCalled();
  });
});

describe('propose_reorganization draft (fileReorgDraft)', () => {
  it('Approve files the SELECTED moves through the approval engine and drops the card', async () => {
    const tab = await freshTab();
    (h.cbs.onReorgDraft as Cb)({ draftId: 'ro-d1', conversationId: tab.id });
    const selected = [{ fromPath: 'a.md', toPath: 'b.md' }];
    await store.approveReorgDraft(tab.id, tab.reorgDrafts[0]!, selected);
    expect(conv().fileReorgDraft).toHaveBeenCalledTimes(1);
    const [, sent] = conv().fileReorgDraft.mock.calls[0];
    expect(sent).toEqual(selected);
    expect(tab.reorgDrafts).toHaveLength(0);
  });

  it('Discard removes the card without moving', async () => {
    const tab = await freshTab();
    (h.cbs.onReorgDraft as Cb)({ draftId: 'ro-d2', conversationId: tab.id });
    store.discardReorgDraft(tab.id, 'ro-d2');
    expect(tab.reorgDrafts).toHaveLength(0);
    expect(conv().fileReorgDraft).not.toHaveBeenCalled();
  });
});

describe('propose_note_delete draft (fileDeleteDraft)', () => {
  it('Approve files the SELECTED deletions through the approval engine and drops the card', async () => {
    const tab = await freshTab();
    (h.cbs.onDeleteDraft as Cb)({ draftId: 'del-d1', conversationId: tab.id });
    const selected = ['notes/gone.md'];
    await store.approveDeleteDraft(tab.id, tab.deleteDrafts[0]!, selected);
    expect(conv().fileDeleteDraft).toHaveBeenCalledTimes(1);
    const [, sent] = conv().fileDeleteDraft.mock.calls[0];
    expect(sent).toEqual(selected);
    expect(tab.deleteDrafts).toHaveLength(0);
  });

  it('Discard removes the card without deleting', async () => {
    const tab = await freshTab();
    (h.cbs.onDeleteDraft as Cb)({ draftId: 'del-d2', conversationId: tab.id });
    store.discardDeleteDraft(tab.id, 'del-d2');
    expect(tab.deleteDrafts).toHaveLength(0);
    expect(conv().fileDeleteDraft).not.toHaveBeenCalled();
  });
});

// ─────────────────────── compute drafts (Run / Insert / Discard) ───────────────────────

/** Seed a compute draft on the tab via its subscription (also seeds state). */
function seedComputeDraft(tab: { id: string }, draftId: string) {
  (h.cbs.onComputeDraft as Cb)({ draftId, conversationId: tab.id });
}
const computeDraft = (tab: { id: string }, draftId: string) => ({
  draftId, conversationId: tab.id, createdAt: 't',
  language: 'sql' as const, code: 'SELECT 1', rationale: 'why', safetyFlags: [],
});

describe('propose_compute draft (runComputeDraft / insertComputeDraft)', () => {
  it('Run gates on consent, executes through api, stores the result, and reloads the transcript', async () => {
    const tab = await freshTab();
    seedComputeDraft(tab, 'cp-1');
    conv().load.mockResolvedValueOnce({ ...tab.conversation, messages: [{ role: 'user', content: 'ctx', timestamp: 't' }] });

    await store.runComputeDraft(tab.id, computeDraft(tab, 'cp-1'));

    expect(ensureComputeConsent).toHaveBeenCalledTimes(1);
    expect(conv().runComputeDraft).toHaveBeenCalledTimes(1);
    const state = (tab as unknown as { computeDraftState: Record<string, { result: unknown; running: boolean }> })
      .computeDraftState['cp-1'];
    expect(state.running).toBe(false);
    expect(state.result).toEqual({ ok: true, format: 'text', value: '42' });
    expect(conv().load).toHaveBeenCalledWith(tab.id);
  });

  it('Run does nothing when the user declines the eyes-on-code consent', async () => {
    const tab = await freshTab();
    seedComputeDraft(tab, 'cp-2');
    ensureComputeConsent.mockResolvedValueOnce(false);
    await store.runComputeDraft(tab.id, computeDraft(tab, 'cp-2'));
    expect(conv().runComputeDraft).not.toHaveBeenCalled();
  });

  it('Run records a failure result when the executor throws', async () => {
    const tab = await freshTab();
    seedComputeDraft(tab, 'cp-3');
    conv().runComputeDraft.mockRejectedValueOnce(new Error('boom'));
    await store.runComputeDraft(tab.id, computeDraft(tab, 'cp-3'));
    const state = (tab as unknown as { computeDraftState: Record<string, { result: { ok: boolean; error?: string }; running: boolean }> })
      .computeDraftState['cp-3'];
    expect(state.running).toBe(false);
    expect(state.result.ok).toBe(false);
    expect(state.result.error).toContain('boom');
  });

  it('Insert files the cell into a note and records the destination', async () => {
    const tab = await freshTab();
    seedComputeDraft(tab, 'cp-4');
    const where = await store.insertComputeDraft(tab.id, computeDraft(tab, 'cp-4'), undefined, 'notes/dest.md');
    expect(conv().insertComputeDraft).toHaveBeenCalledTimes(1);
    expect(where).toBe('notes/inbox/out.md');
    const state = (tab as unknown as { computeDraftState: Record<string, { insertedAt: string | null }> })
      .computeDraftState['cp-4'];
    expect(state.insertedAt).toBe('notes/inbox/out.md');
  });

  it('Insert returns null when the write fails', async () => {
    const tab = await freshTab();
    seedComputeDraft(tab, 'cp-5');
    conv().insertComputeDraft.mockRejectedValueOnce(new Error('nope'));
    const where = await store.insertComputeDraft(tab.id, computeDraft(tab, 'cp-5'));
    expect(where).toBeNull();
  });

  it('Discard removes the compute card and its state entry', async () => {
    const tab = await freshTab();
    seedComputeDraft(tab, 'cp-6');
    expect(tab.computeDrafts.map((d) => d.draftId)).toEqual(['cp-6']);
    store.discardComputeDraft(tab.id, 'cp-6');
    expect(tab.computeDrafts).toHaveLength(0);
    const state = (tab as unknown as { computeDraftState: Record<string, unknown> }).computeDraftState['cp-6'];
    expect(state).toBeUndefined();
  });
});

// ─────────────────────── misc ───────────────────────

describe('runBuiltinCommand', () => {
  it('no-ops loudly on an unknown built-in command', async () => {
    await freshTab();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.runBuiltinCommand('not-a-real-command');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
