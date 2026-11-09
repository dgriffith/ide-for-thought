/**
 * @vitest-environment jsdom
 *
 * The conversations list with branches (#2970): each branch under its parent,
 * saying how it last ran; Branch… asks what the branch is for and forks it;
 * closing a parent says its branches close too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => {
  const conv = (id: string, title: string, branch?: object) => ({ id, title, contextBundle: {}, messages: [], status: 'active', startedAt: 't', ...(branch ? { branch } : {}) });
  const tab = (c: ReturnType<typeof conv>, streaming = false) => ({
    id: c.id, conversation: c, streaming, waiting: null, composer: '', extraTools: [], failure: null, pendingMcpConfirm: null,
    streamedChunks: '', turnStartedAt: null, drafts: [], pendingQuestion: null,
  });
  const tabs = [
    tab(conv('p', 'Launch plan')),
    tab(conv('q', 'Other')),
    tab(conv('b1', 'Risks', { parentId: 'p', atMessage: 2, context: 'summary', outcome: 'done' })),
    tab(conv('b2', 'Costs', { parentId: 'p', atMessage: 2, context: 'summary' }), true),
  ];
  const store = {
    visible: true, height: 320, tabs, activeTabId: 'p', get activeTab() { return tabs[0]; }, initialized: true, needsApiKey: false,
    reset: vi.fn(async () => {}), setActiveTab: vi.fn(), closeTab: vi.fn(async () => {}), hide: vi.fn(),
    branchConversation: vi.fn(async () => null), setHeight: vi.fn(),
  };
  const dialogs = { showPrompt: vi.fn(async () => 'What could go wrong with the launch date?'), showConfirm: vi.fn(async () => false) };
  return { store, dialogs };
});

vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({ getConversationsStore: () => h.store }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialogs }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { tools: { getSettings: vi.fn(async () => ({})) } } }));
vi.mock('../../../src/renderer/lib/components/conversations/MessageList.svelte', async () => ({ default: (await import('../helpers/EmptyComponent.svelte')).default }));
vi.mock('../../../src/renderer/lib/components/conversations/Composer.svelte', async () => ({ default: (await import('../helpers/EmptyComponent.svelte')).default }));

import ConversationsPanel from '../../../src/renderer/lib/components/ConversationsPanel.svelte';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('ConversationsPanel branches (#2970)', () => {
  it('lists each branch under its parent, indented, saying how it last ran', () => {
    const { container } = render(ConversationsPanel, {});
    const items = [...container.querySelectorAll('.conv-item')];
    expect(items.map((i) => i.querySelector('.conv-item-title')!.textContent.trim())).toEqual(['Launch plan', 'Risks', 'Costs', 'Other']);
    expect(items.map((i) => i.classList.contains('branch'))).toEqual([false, true, true, false]);
    expect(items.map((i) => i.querySelector('.conv-item-status')?.textContent ?? null)).toEqual([null, 'Branch · Done', 'Branch · Running', null]);
  });

  it('Branch… asks what the branch is for, then forks it named from the answer', async () => {
    const { getByRole } = render(ConversationsPanel, {});
    await fireEvent.click(getByRole('button', { name: 'Branch…' }));
    await waitFor(() => expect(h.store.branchConversation).toHaveBeenCalledWith('p', {
      title: 'What could go wrong with the launch date?',
      instructions: 'What could go wrong with the launch date?',
    }));
  });

  it('closing a parent says its branches close with it', async () => {
    const { getAllByRole } = render(ConversationsPanel, {});
    await fireEvent.click(getAllByRole('button', { name: 'Close conversation' })[0]!);
    expect(h.dialogs.showConfirm.mock.calls[0]![0]).toMatch(/and its 2 branches/);
    expect(h.store.closeTab).not.toHaveBeenCalled();
  });
});
