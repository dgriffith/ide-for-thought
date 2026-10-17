/**
 * Drafted-extension cards (#2652): the skill or plugin the assistant drafted,
 * waiting in its conversation for the user to save it, install it, save it to
 * a folder, or not.
 *
 * One card per conversation at a time (the turn waits on it). Main keeps the
 * draft and does every write; this store sends only the offer id and the
 * action. A failed save keeps the card, with the reason; a successful one, or
 * "Not now", clears it. A saved skill is registered here too (palette, slash
 * commands); an installed plugin arrives through `plugins:changed` like any
 * other install.
 */
import { api } from '../ipc/client';
import { announce } from './announcer.svelte';
import { applyMenuConfig } from '../../../shared/skills/menu-config';
import { registerSkillInfos } from '../tools/tool-registry';
import { logger } from '../../../shared/logger';
import type { ExtensionDraftAction, ExtensionDraftOffer } from '../../../shared/extensions/drafts';

let offers = $state<Record<string, ExtensionDraftOffer>>({});
let problems = $state<Record<string, string>>({});
let busy = $state<Record<string, boolean>>({});

function drop(conversationId: string): void {
  const { [conversationId]: _offer, ...rest } = offers;
  const { [conversationId]: _problem, ...others } = problems;
  offers = rest;
  problems = others;
}

// Optional chaining, as the other stores do: component tests import this
// with only the `api` surface they mock.
api?.conversations?.onExtensionDraft?.((offer) => {
  offers = { ...offers, [offer.conversationId]: offer };
  announce(`Drafted ${offer.kind === 'plugin' ? 'plugin' : 'skill'}: ${offer.name}. Save it, or not, from the card.`, 'polite');
});

async function act(conversationId: string, action: ExtensionDraftAction): Promise<void> {
  const offer = offers[conversationId];
  if (!offer || busy[conversationId]) return;
  busy = { ...busy, [conversationId]: true };
  try {
    const r = await api.conversations.extensionDraftAction(offer.offerId, action);
    if (r.ok) {
      drop(conversationId);
      if (r.where) announce(`Saved to ${r.where}`, 'polite');
      if (offer.kind === 'skill' && action === 'save') {
        const cat = await api.skills.list();
        registerSkillInfos(applyMenuConfig(cat.skills, cat.config));
      }
    } else if ('error' in r) {
      problems = { ...problems, [conversationId]: r.error };
    }
  } catch (e) {
    logger('conversation').warn('acting on a drafted extension failed:', e);
    problems = { ...problems, [conversationId]: e instanceof Error ? e.message : String(e) };
  } finally {
    const { [conversationId]: _b, ...rest } = busy;
    busy = rest;
  }
}

export const extensionDraftsStore = {
  /** The card waiting in this conversation, if any. */
  offerFor: (conversationId: string): ExtensionDraftOffer | null => offers[conversationId] ?? null,
  /** Why the last save failed, shown on the card. */
  problemFor: (conversationId: string): string | null => problems[conversationId] ?? null,
  busyFor: (conversationId: string): boolean => busy[conversationId] === true,
  act,
  /** The conversation's tab closed: a card nobody can see is "Not now", not a hang. */
  dismissFor(conversationId: string): void {
    if (offers[conversationId]) void act(conversationId, 'dismiss');
  },
  /** The turn ended (finished, stopped or failed): main has already settled the card. */
  clearFor(conversationId: string): void {
    if (offers[conversationId]) drop(conversationId);
  },
};
