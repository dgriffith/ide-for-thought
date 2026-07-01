/**
 * `/compact` store wiring (#824): swap the active tab to the fresh,
 * summarized conversation returned by the main process; leave it alone when
 * there's nothing to compact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation, CompactResult } from '../../../src/shared/types';

const h = vi.hoisted(() => {
  const noop = vi.fn();
  let nextId = 100;
  const api = {
    conversations: {
      onStream: noop, onDraft: noop, onSourceDraft: noop, onPropertyDraft: noop,
      onSourcePropertyDraft: noop, onClaimsDraft: noop, onComputeDraft: noop, onRefactorDraft: noop, onReorgDraft: noop, onDeleteDraft: noop, onNoteBodyDraft: noop, onAskUser: noop,
      saveUIState: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(async (contextBundle: unknown) => ({
        id: `conv-${nextId++}`,
        contextBundle: contextBundle as Conversation['contextBundle'],
        messages: [],
        status: 'active' as const,
        startedAt: 't',
      })),
      compact: vi.fn<(id: string) => Promise<CompactResult>>(),
    },
  };
  return { api };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import { getConversationsStore } from '../../../src/renderer/lib/stores/conversations.svelte';

const store = getConversationsStore();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/compact (#824)', () => {
  it('swaps the active tab to the compacted conversation', async () => {
    await store.openFreeform('notes/origin.md');
    const originalId = store.activeTab!.id;

    const compacted: Conversation = {
      id: 'conv-compacted',
      contextBundle: { notePath: 'notes/origin.md' },
      messages: [
        { role: 'user', content: '**Summary of earlier conversation** (6 messages compacted):\n\nfoo', timestamp: 't' },
        { role: 'user', content: 'recent', timestamp: 't' },
      ],
      status: 'active',
      startedAt: 't',
    };
    h.api.conversations.compact.mockResolvedValueOnce({ compacted: true, conversation: compacted });

    store.runBuiltinCommand('compact');
    await vi.waitFor(() => expect(store.activeTab!.id).toBe('conv-compacted'));

    expect(h.api.conversations.compact).toHaveBeenCalledWith(originalId);
    expect(store.activeTab!.conversation.messages[0].content).toContain('Summary of earlier conversation');
    expect(store.tabs.filter((t) => t.id === originalId)).toHaveLength(0);
    expect(store.activeTab!.streaming).toBe(false);
  });

  it('leaves the conversation untouched when there is nothing to compact', async () => {
    await store.openFreeform('notes/origin.md');
    const id = store.activeTab!.id;
    h.api.conversations.compact.mockResolvedValueOnce({ compacted: false, reason: 'too short' });

    store.runBuiltinCommand('compact');
    await vi.waitFor(() => expect(store.activeTab!.streaming).toBe(false));

    expect(store.activeTab!.id).toBe(id);
  });
});
