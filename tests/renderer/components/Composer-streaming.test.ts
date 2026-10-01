/**
 * @vitest-environment happy-dom
 *
 * Typing while a reply is in progress (#1744): the composer stays editable so
 * the next message can be drafted, but nothing in it can act on the
 * conversation until the turn is done — Enter doesn't send, and the slash
 * launcher (whose /clear would archive the conversation mid-turn) stays shut
 * until the reply finishes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/svelte';
import type { TabRuntime } from '../../../src/renderer/lib/stores/conversations.svelte';

const h = vi.hoisted(() => ({ send: vi.fn(), setComposer: vi.fn(), cancel: vi.fn(), runBuiltinCommand: vi.fn() }));

vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({
  getConversationsStore: () => h,
}));
vi.mock('../../../src/renderer/lib/voice/voice.svelte', () => ({
  getVoiceStore: () => ({ status: 'idle', recording: false, busy: false, surface: null, error: null, modelProgress: null }),
}));
vi.mock('../../../src/renderer/lib/voice/voice-settings.svelte', () => ({ voiceSettings: { enabled: true } }));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ getSlashCommands: () => [] }));

import Composer from '../../../src/renderer/lib/components/conversations/Composer.svelte';

function tab(streaming: boolean, composer = ''): TabRuntime {
  return {
    id: 'tab-1',
    streaming,
    composer,
    conversation: { id: 'c1', contextBundle: {}, status: 'active', startedAt: 't', messages: [] },
  } as unknown as TabRuntime;
}

const textarea = () => screen.getByRole('textbox');

beforeEach(() => { for (const f of Object.values(h)) f.mockReset(); });
afterEach(() => cleanup());

describe('Composer while a reply is in progress (#1744)', () => {
  it('stays editable, and so does dictation', async () => {
    render(Composer, { tab: tab(true), currentNotePath: null });
    expect(textarea().disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Start dictation' })).disabled).toBe(false);
    await fireEvent.input(textarea(), { target: { value: 'and what about Budapest?' } });
    expect(h.setComposer).toHaveBeenCalledWith('and what about Budapest?');
  });

  it('Enter does nothing until the reply finishes, and says so', async () => {
    render(Composer, { tab: tab(true, 'a follow-up'), currentNotePath: null });
    await fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(h.send).not.toHaveBeenCalled();
    expect(screen.getByText('Reply in progress — send when it finishes')).toBeTruthy();
  });

  it('Enter sends once it has', async () => {
    render(Composer, { tab: tab(false, 'a follow-up'), currentNotePath: null });
    await fireEvent.keyDown(textarea(), { key: 'Enter' });
    expect(h.send).toHaveBeenCalledWith('a follow-up', undefined);
  });

  it('keeps the slash launcher shut mid-turn, and opens it when the reply finishes', async () => {
    const { rerender } = render(Composer, { tab: tab(true, '/cl'), currentNotePath: null });
    await fireEvent.input(textarea(), { target: { value: '/cl' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    await rerender({ tab: tab(false, '/cl'), currentNotePath: null });
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByText('/clear')).toBeTruthy();
  });
});
