/**
 * @vitest-environment happy-dom
 *
 * The fork card (#2972), rendered from fork progress events through the real
 * fork-cards store (the api client mocked): a list with each row's status in
 * its name, the live preview, Stop / Stop all by branch id, Open a branch, the
 * folded answers and the cost at the join — and axe-clean in each state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { expectNoA11yViolations } from '../../helpers/axe';
import type { TabRuntime } from '../../../src/renderer/lib/stores/conversations.svelte';
import type { ForkBranchState, ForkProgress } from '../../../src/shared/conversation';

const h = vi.hoisted(() => {
  const cbs: Record<string, (arg: unknown) => void> = {};
  return {
    cbs,
    api: {
      conversations: {
        onFork: vi.fn((cb: (arg: unknown) => void) => { cbs.onFork = cb; }),
        onStream: vi.fn((cb: (arg: unknown) => void) => { cbs.onStream = cb; }),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    },
    store: { openBranchTab: vi.fn().mockResolvedValue(undefined) },
  };
});
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: vi.fn() }));
vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({ getConversationsStore: () => h.store }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => ({ openFile: vi.fn(), openSource: vi.fn() }) }));

import ForkCards from '../../../src/renderer/lib/components/conversations/ForkCards.svelte';
import { clearForkCards, subscribeForkCards } from '../../../src/renderer/lib/stores/fork-cards.svelte';

subscribeForkCards({ anchorFor: () => 1, onBranchSettled: () => {} });

const TITLES = ['Supply', 'Demand', 'Policy'];
const progress = (states: ForkBranchState[], over: Partial<ForkProgress> = {}): ForkProgress => ({
  conversationId: 'conv-p', forkId: 'f-1', estimateUSD: 0.09, joined: false, costUSD: 0,
  branches: states.map((state, i) => ({
    title: TITLES[i]!, conversationId: state === 'starting' ? '' : `b${i + 1}`, state, startedAt: Date.now() - 65_000,
    ...(state === 'done' || state === 'stopped' ? { endedAt: Date.now(), costUSD: 0.0125, answer: state === 'done' ? `**${TITLES[i]}** answer` : 'Half an ans' } : {}),
    ...(state === 'stopped' ? { note: 'stopped' } : {}),
    ...(state === 'failed' ? { endedAt: Date.now(), costUSD: 0, answer: '', note: 'overloaded' } : {}),
  })),
  ...over,
});
const fork = (p: ForkProgress) => { h.cbs.onFork!(p); flushSync(); };

const EMPTY_DRAFTS = {
  drafts: [], sourceDrafts: [], sourceDraftResults: {}, noteDraftResults: {}, propertyDrafts: [], propertyDraftResults: {},
  sourcePropertyDrafts: [], sourcePropertyDraftResults: {}, claimsDrafts: [], claimsDraftResults: {}, computeDrafts: [],
  refactorDrafts: [], reorgDrafts: [], deleteDrafts: [], noteBodyDrafts: [], computeDraftState: {},
};
const tab = { id: 'conv-p', conversation: { messages: [{}, {}] }, ...EMPTY_DRAFTS } as unknown as TabRuntime;
function mount() {
  const target = document.body.appendChild(document.createElement('main'));
  return render(ForkCards, { target, props: { tab, index: 1 } });
}

beforeEach(() => { vi.clearAllMocks(); clearForkCards(); });
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

describe('the fork card (#2972)', () => {
  it('renders from fork events: a list, each row named with its status, the estimate', async () => {
    fork(progress(['starting', 'running', 'running']));
    const r = mount();
    const list = r.getByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((li) => li.getAttribute('aria-label'))).toEqual(['Supply, starting', 'Demand, running', 'Policy, running']);
    expect(r.getByText('Estimated $0.0900')).toBeTruthy();
    expect(r.getAllByText(/running · 1m 0[45]s/)).toHaveLength(2);
    // A starting branch has nothing to open or stop yet.
    expect((r.getByRole('button', { name: 'Open branch Supply' }) as HTMLButtonElement).disabled).toBe(true);
    expect(r.queryByRole('button', { name: 'Stop branch Supply' })).toBeNull();
    await expectNoA11yViolations(document.body);
  });

  it('shows a running branch\'s streamed text in a collapsed preview', () => {
    fork(progress(['running']));
    h.cbs.onStream!({ conversationId: 'b1', text: 'Supply is tight' });
    flushSync();
    const r = mount();
    const preview = r.getByText('Supply is tight');
    expect(preview.closest('details')!.open).toBe(false);
  });

  it('Stop stops that branch; Stop all stops the ones still running', async () => {
    fork(progress(['done', 'running', 'running']));
    const r = mount();
    await fireEvent.click(r.getByRole('button', { name: 'Stop branch Demand' }));
    expect(h.api.conversations.cancel).toHaveBeenCalledWith('b2');
    h.api.conversations.cancel.mockClear();
    await fireEvent.click(r.getByRole('button', { name: 'Stop all' }));
    expect(h.api.conversations.cancel.mock.calls.map((c) => c[0]).sort()).toEqual(['b2', 'b3']);
  });

  it('Open opens that branch in a tab', async () => {
    fork(progress(['running', 'running']));
    const r = mount();
    await fireEvent.click(r.getByRole('button', { name: 'Open branch Demand' }));
    expect(h.store.openBranchTab).toHaveBeenCalledWith('b2');
  });

  it('at the join: each answer folded, a stopped one\'s partial, a failure\'s reason, the cost', async () => {
    fork(progress(['running', 'running', 'running']));
    fork(progress(['done', 'stopped', 'failed'], { joined: true, costUSD: 0.025 }));
    const r = mount();
    expect(within(r.getByRole('list')).getAllByRole('listitem').map((li) => li.getAttribute('aria-label')))
      .toEqual(['Supply, finished', 'Demand, stopped', 'Policy, failed']);
    expect(r.getByText(/Forked into 3 branches — joined/)).toBeTruthy();
    expect(r.getByText('Cost $0.0250 (estimated $0.0900)')).toBeTruthy();
    const answer = r.getByText('Supply', { selector: 'strong' });
    expect(answer.closest('details')!.open).toBe(false);
    expect(r.getByText('What it had written')).toBeTruthy();
    expect(r.getByText('overloaded')).toBeTruthy();
    expect(r.queryByRole('button', { name: 'Stop all' })).toBeNull();
    await expectNoA11yViolations(document.body);
  });

  it('renders only the cards anchored where it is placed', () => {
    fork(progress(['running']));
    const target = document.body.appendChild(document.createElement('main'));
    const r = render(ForkCards, { target, props: { tab, index: 0 } });
    expect(r.queryByRole('list')).toBeNull();
  });

  it('shows what each branch proposed under its row, for review in the parent (#2973)', async () => {
    fork(progress(['running', 'running']));
    const withDrafts = {
      ...tab,
      drafts: [{
        draftId: 'bd', conversationId: 'b2', createdAt: 't', note: 'Demand notes, filed', afterMessageIndex: 1,
        branch: { parentId: 'conv-p', title: 'Demand' }, payloads: [{ kind: 'note', relativePath: 'notes/demand.md', content: '# Demand' }],
      }],
    } as unknown as TabRuntime;
    const target = document.body.appendChild(document.createElement('main'));
    const r = render(ForkCards, { target, props: { tab: withDrafts, index: 1 } });
    const demand = r.getByRole('listitem', { name: 'Demand, running' });
    const supply = r.getByRole('listitem', { name: 'Supply, running' });
    expect(within(demand).getByText('Demand notes, filed')).toBeTruthy();
    expect(within(supply).queryByText('Demand notes, filed')).toBeNull();
    await expectNoA11yViolations(document.body);
  });
});
