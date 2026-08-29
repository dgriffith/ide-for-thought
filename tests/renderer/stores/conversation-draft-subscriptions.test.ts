/**
 * Characterization tests for the conversations store's draft-subscription
 * plumbing (#980). The store fans out ~10 near-identical `onXxxDraft`
 * subscriptions, each of which: finds the tab by `conversationId`, anchors the
 * draft at `afterMessageIndex = messages.length`, and appends it to that tab's
 * `xxxDrafts` array. `computeDraft` additionally seeds `computeDraftState`.
 *
 * These lock the CURRENT behavior so the subscription-factory refactor (H4) is
 * provably behavior-preserving. Drives the real store with a mocked api client
 * that captures every subscription callback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Conversation } from '../../../src/shared/conversation';

type Cb = (draft: { draftId: string; conversationId: string }) => void;

const h = vi.hoisted(() => {
  const noop = vi.fn();
  const cbs: Record<string, Cb> = {};
  // Each subscribe fn is a vi.fn so we can both capture the callback and assert
  // it was registered exactly once (the idempotency the per-kind flags enforce).
  const cap = (name: string) => vi.fn((cb: Cb) => { cbs[name] = cb; });
  let nextId = 1;
  const api = {
    conversations: {
      onStream: noop,
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
      onAskUser: noop,
      saveUIState: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue(undefined),
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
  return { api, cbs };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import { getConversationsStore } from '../../../src/renderer/lib/stores/conversations.svelte';

const store = getConversationsStore();

/** The uniform draft kinds: which subscription feeds which tab array. */
const KINDS: Array<{ cb: string; array: string }> = [
  { cb: 'onDraft', array: 'drafts' },
  { cb: 'onSourceDraft', array: 'sourceDrafts' },
  { cb: 'onPropertyDraft', array: 'propertyDrafts' },
  { cb: 'onSourcePropertyDraft', array: 'sourcePropertyDrafts' },
  { cb: 'onClaimsDraft', array: 'claimsDrafts' },
  { cb: 'onComputeDraft', array: 'computeDrafts' },
  { cb: 'onRefactorDraft', array: 'refactorDrafts' },
  { cb: 'onReorgDraft', array: 'reorgDrafts' },
  { cb: 'onDeleteDraft', array: 'deleteDrafts' },
  { cb: 'onNoteBodyDraft', array: 'noteBodyDrafts' },
];

const arrayOf = (tab: unknown, key: string) =>
  (tab as Record<string, Array<{ draftId: string; afterMessageIndex: number }>>)[key];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('conversation draft subscriptions (#980)', () => {
  it('each draft kind lands in its tab array, anchored at messages.length', async () => {
    for (const { cb, array } of KINDS) {
      await store.openFreeform('notes/x.md');
      const tab = store.activeTab!;
      const at = tab.conversation.messages.length; // 0 for a fresh tab
      h.cbs[cb]({ draftId: `${array}-1`, conversationId: tab.id });

      const arr = arrayOf(tab, array);
      expect(arr.map((d) => d.draftId), `${cb} → tab.${array}`).toEqual([`${array}-1`]);
      expect(arr[0].afterMessageIndex, `${cb} anchor`).toBe(at);
    }
  });

  it('ignores a draft whose conversationId matches no open tab', async () => {
    await store.openFreeform('notes/y.md');
    const tab = store.activeTab!;
    const before = tab.drafts.length;
    h.cbs.onDraft({ draftId: 'ghost', conversationId: 'no-such-tab' });
    expect(tab.drafts.length).toBe(before);
  });

  it('compute drafts also seed a pristine computeDraftState entry', async () => {
    await store.openFreeform('notes/z.md');
    const tab = store.activeTab!;
    h.cbs.onComputeDraft({ draftId: 'c-1', conversationId: tab.id });

    expect(tab.computeDrafts.map((d) => d.draftId)).toEqual(['c-1']);
    const state = (tab as unknown as {
      computeDraftState: Record<string, { result: unknown; running: boolean; insertedAt: unknown; afterMessageIndex: number }>;
    }).computeDraftState['c-1'];
    expect(state).toBeDefined();
    expect(state.result).toBeNull();
    expect(state.running).toBe(false);
    expect(state.insertedAt).toBeNull();
    expect(state.afterMessageIndex).toBe(0);
  });

  it('subscribes to each draft channel exactly once across many opens', async () => {
    // The store is a singleton; ensureSubscriptions runs on every open but the
    // guard flags keep each channel subscribed once. clearAllMocks() has reset
    // the counters, so no *new* registrations should occur on further opens.
    await store.openFreeform('notes/a.md');
    await store.openFreeform('notes/b.md');
    for (const { cb } of KINDS) {
      expect(h.api.conversations[cb as keyof typeof h.api.conversations], cb).not.toHaveBeenCalled();
    }
  });
});
