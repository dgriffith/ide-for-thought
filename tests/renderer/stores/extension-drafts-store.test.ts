/**
 * The drafted-extension card's store (#2652): an offer arrives over its
 * subscription and waits in its conversation; acting sends only the offer id
 * and the action (main writes, from its own copy); a saved skill is
 * registered in this window; a failed save keeps the card with its reason;
 * closing the tab is "Not now".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionDraftActionResult, ExtensionDraftOffer } from '../../../src/shared/extensions/drafts';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('conversation');

const h = vi.hoisted(() => ({
  onOffer: null as ((offer: unknown) => void) | null,
  extensionDraftAction: vi.fn(),
  skillsList: vi.fn(async () => ({ skills: [{ id: 'my.weekly' }], config: { disabled: [], overrides: {}, order: {} } })),
  registerSkillInfos: vi.fn(),
  announce: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    conversations: {
      onExtensionDraft: (cb: (offer: unknown) => void) => { h.onOffer = cb; return () => {}; },
      extensionDraftAction: h.extensionDraftAction,
    },
    skills: { list: h.skillsList },
  },
}));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ registerSkillInfos: h.registerSkillInfos }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));
vi.mock('../../../src/shared/skills/menu-config', () => ({ applyMenuConfig: (skills: unknown) => skills }));

import { extensionDraftsStore as store } from '../../../src/renderer/lib/stores/extension-drafts.svelte';

const offer = (over: Partial<ExtensionDraftOffer> = {}): ExtensionDraftOffer => ({
  offerId: 'o1', conversationId: 'c1', kind: 'skill', id: 'my.weekly', name: 'Weekly', summary: 's',
  files: [{ path: 'weekly.md', content: '---' }], ...over,
});
const answer = (r: ExtensionDraftActionResult) => h.extensionDraftAction.mockResolvedValueOnce(r);

beforeEach(() => {
  vi.clearAllMocks();
  store.clearFor('c1');
  store.clearFor('c2');
});

describe('extension drafts store (#2652)', () => {
  it('an offer waits in its own conversation, and is announced', () => {
    h.onOffer!(offer());
    expect(store.offerFor('c1')?.offerId).toBe('o1');
    expect(store.offerFor('c2')).toBeNull();
    expect(h.announce).toHaveBeenCalledWith(expect.stringContaining('Drafted skill: Weekly'), 'polite');
  });

  it('saving sends only the offer id and the action, clears the card and registers the skill', async () => {
    h.onOffer!(offer());
    answer({ ok: true, action: 'save', where: '/home/u/.minerva/skills/weekly.md' });
    await store.act('c1', 'save');
    expect(h.extensionDraftAction).toHaveBeenCalledWith('o1', 'save');
    expect(store.offerFor('c1')).toBeNull();
    expect(h.registerSkillInfos).toHaveBeenCalledWith([{ id: 'my.weekly' }]);
  });

  it('installing a plugin leaves registering to plugins:changed', async () => {
    h.onOffer!(offer({ kind: 'plugin', id: 'lab' }));
    answer({ ok: true, action: 'save', where: '/p/lab' });
    await store.act('c1', 'save');
    expect(h.registerSkillInfos).not.toHaveBeenCalled();
  });

  it('a failed save keeps the card, with why; a cancelled picker keeps it quietly', async () => {
    h.onOffer!(offer());
    answer({ ok: false, error: 'You already have a skill with the id "my.weekly".' });
    await store.act('c1', 'save');
    expect(store.offerFor('c1')).not.toBeNull();
    expect(store.problemFor('c1')).toBe('You already have a skill with the id "my.weekly".');
    answer({ ok: false, cancelled: true });
    await store.act('c1', 'save-folder');
    expect(store.offerFor('c1')).not.toBeNull();
    h.extensionDraftAction.mockRejectedValueOnce(new Error('ipc down'));
    await store.act('c1', 'save');
    expect(store.problemFor('c1')).toBe('ipc down');
    expect(store.busyFor('c1')).toBe(false);
  });

  it('closing the tab is Not now; the end of a turn just clears it', async () => {
    h.onOffer!(offer());
    answer({ ok: true, action: 'dismiss' });
    store.dismissFor('c1');
    await vi.waitFor(() => expect(h.extensionDraftAction).toHaveBeenCalledWith('o1', 'dismiss'));
    h.onOffer!(offer({ conversationId: 'c2', offerId: 'o2' }));
    store.clearFor('c2');
    expect(store.offerFor('c2')).toBeNull();
    store.dismissFor('c2');
    expect(h.extensionDraftAction).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a conversation with no card', async () => {
    await store.act('nope', 'save');
    expect(h.extensionDraftAction).not.toHaveBeenCalled();
  });
});
