/**
 * Fork cards (#2972): built from main's fork progress events, previews fed by
 * each branch's own stream, a branch settling announced once, Stop and Stop
 * all by branch id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ForkProgress, ForkBranchState } from '../../../src/shared/conversation';

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
    announce: vi.fn(),
  };
});
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));

import {
  clearForkCards, dropForkCards, forkCardsFor, liveBranch, stopAllBranches, stopBranch, subscribeForkCards,
} from '../../../src/renderer/lib/stores/fork-cards.svelte';

const anchorFor = vi.fn((id: string): number | null => (id === 'conv-p' ? 3 : null));
const onBranchSettled = vi.fn();
subscribeForkCards({ anchorFor, onBranchSettled });

const progress = (states: ForkBranchState[], over: Partial<ForkProgress> = {}): ForkProgress => ({
  conversationId: 'conv-p', forkId: 'f-1', estimateUSD: 0.09, joined: false, costUSD: 0,
  branches: states.map((state, i) => ({
    title: ['Supply', 'Demand', 'Policy'][i]!, conversationId: state === 'starting' ? '' : `b${i + 1}`, state, startedAt: 1000,
    ...(state === 'done' ? { endedAt: 5000, answer: `Answer ${i + 1}`, costUSD: 0.01 } : {}),
  })),
  ...over,
});
const fork = (p: ForkProgress) => h.cbs.onFork!(p);
const stream = (conversationId: string, text: string) => h.cbs.onStream!({ conversationId, text });

beforeEach(() => {
  vi.clearAllMocks();
  clearForkCards();
});

describe('fork cards (#2972)', () => {
  it('a card appears on its parent, anchored at the parent\'s message count, and follows each event', () => {
    fork(progress(['starting', 'starting', 'starting']));
    expect(forkCardsFor('conv-p')).toHaveLength(1);
    expect(forkCardsFor('conv-p')[0]).toMatchObject({ afterMessageIndex: 3, estimateUSD: 0.09 });
    fork(progress(['running', 'running', 'starting']));
    expect(forkCardsFor('conv-p')[0]!.branches.map((b) => b.state)).toEqual(['running', 'running', 'starting']);
    // The anchor is where the fork began, not where the parent is now: looked up once.
    fork(progress(['done', 'running', 'running']));
    expect(anchorFor).toHaveBeenCalledTimes(1);
    expect(forkCardsFor('conv-p')[0]!.afterMessageIndex).toBe(3);
    expect(forkCardsFor('conv-other')).toEqual([]);
  });

  it('a fork for a conversation no tab shows has no card', () => {
    fork(progress(['starting'], { conversationId: 'conv-gone', forkId: 'f-x' }));
    expect(forkCardsFor('conv-gone')).toEqual([]);
  });

  it('a running branch\'s stream is its preview; other conversations\' text isn\'t', () => {
    fork(progress(['running', 'running']));
    stream('b1', 'Supply is ');
    stream('b1', 'tight.');
    stream('b2', 'Demand');
    stream('conv-p', 'the parent\'s own reply');
    const card = forkCardsFor('conv-p')[0]!;
    expect(card.previews).toEqual({ b1: 'Supply is tight.', b2: 'Demand' });
    expect(liveBranch('b1')).toEqual({ startedAt: 1000, text: 'Supply is tight.' });
    fork(progress(['done', 'running']));
    stream('b1', ' late');
    expect(forkCardsFor('conv-p')[0]!.previews.b1).toBe('Supply is tight.');
    expect(liveBranch('b1')).toBeNull();
  });

  it('a branch settling is announced once, by its title, and its open tab is told', () => {
    fork(progress(['running', 'running', 'running']));
    fork(progress(['done', 'running', 'running']));
    fork(progress(['done', 'stopped', 'running']));
    fork(progress(['done', 'stopped', 'failed']));
    fork(progress(['done', 'stopped', 'failed'], { joined: true, costUSD: 0.01 }));
    expect(h.announce.mock.calls.map((c) => c[0])).toEqual([
      'Branch “Supply” finished', 'Branch “Demand” stopped', 'Branch “Policy” failed',
    ]);
    expect(onBranchSettled.mock.calls.map((c) => c[0])).toEqual(['b1', 'b2', 'b3']);
    expect(forkCardsFor('conv-p')[0]).toMatchObject({ joined: true, costUSD: 0.01 });
  });

  it('Stop stops one branch by id; Stop all stops every branch still running, not the parent', async () => {
    fork(progress(['done', 'running', 'running']));
    await stopBranch('b2');
    expect(h.api.conversations.cancel).toHaveBeenCalledWith('b2');
    h.api.conversations.cancel.mockClear();
    await stopAllBranches('f-1');
    expect(h.api.conversations.cancel.mock.calls.map((c) => c[0]).sort()).toEqual(['b2', 'b3']);
    expect(h.api.conversations.cancel).not.toHaveBeenCalledWith('conv-p');
  });

  it('closing the parent drops its cards', () => {
    fork(progress(['running']));
    dropForkCards('conv-p');
    expect(forkCardsFor('conv-p')).toEqual([]);
  });
});
