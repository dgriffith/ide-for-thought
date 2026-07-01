/**
 * `/clear` built-in command (#823): archive the active conversation and open a
 * fresh one in its place, carrying the same context. Drives the conversations
 * store with a mocked api client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation } from '../../../src/shared/types';

const h = vi.hoisted(() => {
  const noop = vi.fn();
  let nextId = 1;
  const created: Conversation[] = [];
  const api = {
    conversations: {
      // subscriptions used by ensureSubscriptions()
      onStream: noop, onDraft: noop, onSourceDraft: noop, onPropertyDraft: noop,
      onSourcePropertyDraft: noop, onClaimsDraft: noop, onComputeDraft: noop, onRefactorDraft: noop, onReorgDraft: noop, onDeleteDraft: noop, onNoteBodyDraft: noop, onAskUser: noop,
      saveUIState: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(async (contextBundle: unknown, triggerNodeUri?: string, options?: { systemPrompt?: string; model?: string }) => {
        const conv: Conversation = {
          id: `conv-${nextId++}`,
          contextBundle: contextBundle as Conversation['contextBundle'],
          triggerNodeUri,
          messages: [],
          status: 'active',
          startedAt: 't',
          ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
          ...(options?.model ? { model: options.model } : {}),
        };
        created.push(conv);
        return conv;
      }),
    },
  };
  return { api, created };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import { getConversationsStore } from '../../../src/renderer/lib/stores/conversations.svelte';

const store = getConversationsStore();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/clear (#823)', () => {
  it('archives the current conversation and opens a fresh one with the same context', async () => {
    await store.openFreeform('notes/origin.md');
    const original = store.activeTab!;
    original.conversation.model = 'claude-opus-4-8';
    // Make the conversation non-empty so /clear has something to archive.
    original.conversation.messages.push({ role: 'user', content: 'hi', timestamp: 't' });
    const originalId = original.id;

    store.runBuiltinCommand('clear');
    await vi.waitFor(() => expect(store.activeTab!.id).not.toBe(originalId));

    expect(h.api.conversations.archive).toHaveBeenCalledWith(originalId);
    // Fresh conversation carries the same origin note + the model override.
    const last = h.created[h.created.length - 1];
    expect(last.contextBundle.notePath).toBe('notes/origin.md');
    expect(last.model).toBe('claude-opus-4-8');
    // The fresh conversation is active, empty, and occupies the same single tab.
    expect(store.activeTab!.conversation.messages).toHaveLength(0);
    expect(store.tabs.filter((t) => t.id === originalId)).toHaveLength(0);
  });

  it('no-ops on an empty, never-used conversation (no archive churn)', async () => {
    await store.openFreeform('notes/origin.md');
    const id = store.activeTab!.id;
    store.runBuiltinCommand('clear');
    await Promise.resolve();
    expect(h.api.conversations.archive).not.toHaveBeenCalled();
    expect(store.activeTab!.id).toBe(id);
  });
});
