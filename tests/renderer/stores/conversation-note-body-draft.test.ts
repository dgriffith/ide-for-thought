/**
 * propose_note_body review flow (#938): a note-body draft arrives over the
 * subscription, renders as a pending card in the active tab, and Approve routes
 * through `fileNoteBodyDraft` (the approval engine) while Discard writes nothing.
 * Drives the conversations store with a mocked api client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation } from '../../../src/shared/conversation';
import type { ConversationNoteBodyDraft } from '../../../src/shared/conversation-note-body-drafts';

const h = vi.hoisted(() => {
  const noop = vi.fn();
  let nextId = 1;
  // Capture the subscription callback the store registers so the test can
  // simulate a draft arriving from main.
  let noteBodyCb: ((draft: ConversationNoteBodyDraft) => void) | null = null;
  const api = {
    conversations: {
      onStream: noop, onDraft: noop, onSourceDraft: noop, onPropertyDraft: noop,
      onSourcePropertyDraft: noop, onClaimsDraft: noop, onComputeDraft: noop,
      onRefactorDraft: noop, onReorgDraft: noop, onDeleteDraft: noop,
      onNoteBodyDraft: (cb: (draft: ConversationNoteBodyDraft) => void) => { noteBodyCb = cb; },
      onAskUser: noop,
      saveUIState: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue(undefined),
      fileNoteBodyDraft: vi.fn().mockResolvedValue({ proposalUri: 'urn:p1', applied: true }),
      create: vi.fn(async (contextBundle: unknown) => {
        const conv: Conversation = {
          id: `conv-${nextId++}`,
          contextBundle: contextBundle as Conversation['contextBundle'],
          messages: [],
          status: 'active',
          startedAt: 't',
        };
        return conv;
      }),
    },
  };
  return { api, getCb: () => noteBodyCb };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import { getConversationsStore } from '../../../src/renderer/lib/stores/conversations.svelte';

const store = getConversationsStore();

function draftFor(conversationId: string): ConversationNoteBodyDraft {
  return {
    draftId: 'nb-1',
    conversationId,
    note: 'Flesh out the stub',
    relativePath: 'notes/stub.md',
    beforeContent: '# Stub\n\nrough.\n',
    afterContent: '# Stub\n\nA fuller draft.\n',
    createdAt: 't',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('propose_note_body review flow (#938)', () => {
  it('surfaces an arriving draft as a pending card on the matching tab', async () => {
    await store.openFreeform('notes/stub.md');
    const tab = store.activeTab!;
    h.getCb()!(draftFor(tab.id));
    expect(tab.noteBodyDrafts.map((d) => d.draftId)).toEqual(['nb-1']);
  });

  it('Approve files the rewrite through the approval engine and drops the card', async () => {
    await store.openFreeform('notes/stub.md');
    const tab = store.activeTab!;
    const draft = draftFor(tab.id);
    h.getCb()!(draft);

    await store.approveNoteBodyDraft(tab.id, tab.noteBodyDrafts[0]);

    expect(h.api.conversations.fileNoteBodyDraft).toHaveBeenCalledTimes(1);
    const [sent] = h.api.conversations.fileNoteBodyDraft.mock.calls[0];
    expect(sent.relativePath).toBe('notes/stub.md');
    expect(sent.afterContent).toBe(draft.afterContent);
    // Card cleared after approval.
    expect(tab.noteBodyDrafts).toHaveLength(0);
  });

  it('Discard removes the card without writing anything', async () => {
    await store.openFreeform('notes/stub.md');
    const tab = store.activeTab!;
    h.getCb()!(draftFor(tab.id));

    store.discardNoteBodyDraft(tab.id, 'nb-1');

    expect(tab.noteBodyDrafts).toHaveLength(0);
    expect(h.api.conversations.fileNoteBodyDraft).not.toHaveBeenCalled();
  });
});
