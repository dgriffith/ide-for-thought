/**
 * Fork cards (#2972): one per fork, in the transcript of the conversation that
 * forked, built from main's `conversation:fork` progress events.
 *
 * - **Anchoring.** A card sits after the message index its parent had when the
 *   fork began — the drafts' convention, so it lands right after the reply
 *   that forked once that reply is saved, and with the orphans at the bottom
 *   while the turn is still running.
 * - **Previews.** A branch's turn streams under its own id on the ordinary
 *   stream channel. No tab shows it unless the user opens one, so the card
 *   keeps the text itself, for the collapsed preview and for a tab opened
 *   mid-turn to start from.
 * - **Stop** cancels a branch by id: branch turns run in the parent's window,
 *   which is the window allowed to stop them. Stop all stops every branch
 *   still running and leaves the parent's turn going — it joins on what the
 *   branches had.
 * - **Announcements.** A branch settling is said once ("Branch “Supply”
 *   finished"); its streaming text never is.
 *
 * Cards live for the session, not on disk: after a reload the fork's branches
 * are in the conversations list, nested under their parent.
 */
import { api } from '../ipc/client';
import { announce } from './announcer.svelte';
import type { ForkProgress } from '../../../shared/conversation';

export interface ForkCard extends ForkProgress {
  /** After which of the parent's messages the card renders. */
  afterMessageIndex: number;
  /** Each branch's streamed text so far, by conversation id. */
  previews: Record<string, string>;
}

export interface ForkCardHooks {
  /** The parent's message count when its fork begins; null when no tab shows the parent. */
  anchorFor: (parentId: string) => number | null;
  /** A branch settled: a tab showing it live can load its finished transcript. */
  onBranchSettled: (branchId: string) => void;
}

/** The preview keeps the end of a long reply: it's the part still changing. */
const PREVIEW_MAX = 4000;
const SETTLED_WORD = { done: 'finished', stopped: 'stopped', failed: 'failed' } as const;

let cards = $state<ForkCard[]>([]);
let subscribed = false;

/** Subscribe once, from the conversations store, which knows the tabs. */
export function subscribeForkCards(hooks: ForkCardHooks): void {
  if (subscribed) return;
  subscribed = true;
  api.conversations.onFork((progress) => {
    const i = cards.findIndex((c) => c.forkId === progress.forkId);
    const prev = cards[i];
    if (!prev) {
      const anchor = hooks.anchorFor(progress.conversationId);
      if (anchor === null) return;
      cards = [...cards, { ...progress, afterMessageIndex: anchor, previews: {} }];
      return;
    }
    progress.branches.forEach((b, j) => {
      const was = prev.branches[j];
      if (b.state !== 'done' && b.state !== 'stopped' && b.state !== 'failed') return;
      if (was?.state === b.state) return;
      announce(`Branch “${b.title}” ${SETTLED_WORD[b.state]}`);
      if (b.conversationId) hooks.onBranchSettled(b.conversationId);
    });
    cards[i] = { ...prev, ...progress, afterMessageIndex: prev.afterMessageIndex, previews: prev.previews };
  });
  api.conversations.onStream(({ conversationId, text }) => {
    for (const card of cards) {
      if (!card.branches.some((b) => b.conversationId === conversationId && b.state === 'running')) continue;
      card.previews[conversationId] = ((card.previews[conversationId] ?? '') + text).slice(-PREVIEW_MAX);
    }
  });
}

/** The cards for one parent conversation, in the order they began. */
export function forkCardsFor(parentId: string): ForkCard[] {
  return cards.filter((c) => c.conversationId === parentId);
}

/** A branch still running, with when it started and what it has written: an opened tab starts from it. */
export function liveBranch(branchId: string): { startedAt: number; text: string } | null {
  for (const card of cards) {
    const b = card.branches.find((x) => x.conversationId === branchId && x.state === 'running');
    if (b) return { startedAt: b.startedAt, text: card.previews[branchId] ?? '' };
  }
  return null;
}

export async function stopBranch(branchId: string): Promise<void> {
  await api.conversations.cancel(branchId);
}

/** Stop every branch of a fork still running; the parent's turn carries on with what they had. */
export async function stopAllBranches(forkId: string): Promise<void> {
  const card = cards.find((c) => c.forkId === forkId);
  if (!card) return;
  const running = card.branches.filter((b) => b.state === 'running' && b.conversationId);
  await Promise.all(running.map((b) => api.conversations.cancel(b.conversationId)));
}

/** A closed parent takes its cards with it. */
export function dropForkCards(parentId: string): void {
  cards = cards.filter((c) => c.conversationId !== parentId);
}

/** A different thoughtbase: none of these cards belong to it. */
export function clearForkCards(): void {
  cards = [];
}
