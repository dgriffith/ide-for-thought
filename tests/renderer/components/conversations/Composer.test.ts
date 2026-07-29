/**
 * @vitest-environment happy-dom
 *
 * Render + interaction coverage for the conversation Composer (~0% covered).
 * Drives the real component the way a user does — type into the textarea,
 * ⏎ to send, ⇧⏎ for a newline, Cancel while streaming, and the `/` slash
 * launcher — and asserts the visible DOM plus the store methods the composer
 * is wired to (`setComposer` / `send` / `cancel` / `runBuiltinCommand`).
 *
 * The composer is a *controlled* textarea (`value={tab.composer}`, not a
 * two-way bind): the input handler forwards each keystroke to `store.setComposer`
 * and the send path reads `tab.composer`, so the meaningful assertions are the
 * store calls, and the fixture seeds `tab.composer` for the send tests.
 *
 * The conversations / voice stores and the slash-command registry are mocked;
 * the pure slash helpers (buildSlashMenu → the reserved `/clear` `/compact`
 * built-ins) and the cost-badge formatter run for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { ConversationMessage } from '../../../../src/shared/types';

// ── Store mocks ───────────────────────────────────────────────────────────
const send = vi.fn();
const cancel = vi.fn();
const setComposer = vi.fn();
const runBuiltinCommand = vi.fn();

vi.mock('../../../../src/renderer/lib/stores/conversations.svelte', () => ({
  getConversationsStore: () => ({
    send,
    cancel,
    setComposer,
    runBuiltinCommand,
    answerQuestion: vi.fn(),
  }),
}));

// Voice disabled by default → the mic UI stays out of the way. A per-test
// override re-mocks `voiceSettings.enabled`/the voice store where needed.
vi.mock('../../../../src/renderer/lib/voice/voice.svelte', () => ({
  getVoiceStore: () => ({
    status: 'idle',
    surface: null,
    error: null,
    modelProgress: null,
    recording: false,
    busy: false,
    start: vi.fn(),
    stopAndTranscribe: vi.fn(),
    cancel: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('../../../../src/renderer/lib/voice/voice-settings.svelte', () => ({
  voiceSettings: { enabled: false },
}));

// Empty skill registry — the slash menu then shows only the reserved
// built-ins (`/clear`, `/compact`), which come from the real pure helpers.
vi.mock('../../../../src/renderer/lib/tools/tool-registry', () => ({
  getSlashCommands: () => [],
}));

import Composer from '../../../../src/renderer/lib/components/conversations/Composer.svelte';

afterEach(cleanup);
beforeEach(() => {
  send.mockClear();
  cancel.mockClear();
  setComposer.mockClear();
  runBuiltinCommand.mockClear();
});

type TabLike = Record<string, unknown>;

function makeTab(over: {
  composer?: string;
  streaming?: boolean;
  notePath?: string | null;
  messages?: ConversationMessage[];
} = {}): TabLike {
  return {
    id: 'tab-1',
    title: null,
    composer: over.composer ?? '',
    streaming: over.streaming ?? false,
    streamedChunks: '',
    pendingQuestion: null,
    extraTools: [],
    conversation: {
      messages: over.messages ?? [],
      contextBundle: { notePath: over.notePath ?? null },
    },
  };
}

function renderComposer(over: Parameters<typeof makeTab>[0] & { currentNotePath?: string | null } = {}) {
  const { currentNotePath, ...tabOver } = over;
  const r = render(Composer, {
    tab: makeTab(tabOver) as never,
    currentNotePath: currentNotePath ?? null,
    onInvokeSkill: vi.fn(),
  });
  const textarea = r.container.querySelector('textarea') as HTMLTextAreaElement;
  return { ...r, textarea };
}

describe('Composer — render + interaction (~0% covered)', () => {
  it('renders the textarea and the send hint, defaulting to the no-note placeholder', () => {
    const { textarea, getByText } = renderComposer();
    expect(textarea).toBeTruthy();
    expect(textarea.placeholder).toBe('Ask anything, or type / for skills…');
    expect(getByText('⏎ send · ⇧⏎ newline')).toBeTruthy();
    expect(getByText('Send')).toBeTruthy();
  });

  it('shows the note-scoped placeholder + context chip when the conversation has an anchor note', () => {
    const { textarea, getByText } = renderComposer({ notePath: 'notes/topic.md' });
    expect(textarea.placeholder).toBe('Ask about this note, or type / for skills…');
    expect(getByText('notes/topic.md')).toBeTruthy();
  });

  it('typing forwards the value to store.setComposer and does NOT open the slash menu for prose', async () => {
    const { textarea, container } = renderComposer();
    await fireEvent.input(textarea, { target: { value: 'hello world' } });
    expect(setComposer).toHaveBeenCalledWith('hello world');
    expect(container.querySelector('.slash-menu')).toBeNull();
  });

  it('⏎ (no shift) sends the composer text with the current note path', async () => {
    const { textarea } = renderComposer({ composer: 'what is this?', currentNotePath: 'notes/active.md' });
    await fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('what is this?', 'notes/active.md');
  });

  it('⇧⏎ inserts a newline and does NOT send', async () => {
    const { textarea } = renderComposer({ composer: 'line one' });
    await fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('clicking Send fires store.send with the composer text', async () => {
    const { getByText } = renderComposer({ composer: 'ship it', currentNotePath: 'notes/x.md' });
    await fireEvent.click(getByText('Send'));
    expect(send).toHaveBeenCalledWith('ship it', 'notes/x.md');
  });

  it('an empty composer disables Send, so clicking it is a no-op', async () => {
    const { getByText } = renderComposer({ composer: '   ' });
    const btn = getByText('Send').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await fireEvent.click(btn);
    expect(send).not.toHaveBeenCalled();
  });

  it('while streaming: the textarea is disabled, Send is replaced by Cancel, and Cancel fires store.cancel', async () => {
    const { textarea, getByText, queryByText } = renderComposer({ streaming: true, composer: 'in flight' });
    expect(textarea.disabled).toBe(true);
    expect(queryByText('Send')).toBeNull();
    await fireEvent.click(getByText('Cancel'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('renders the running cost badge once a turn reports usage', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'hi', timestamp: '2026-07-28T00:00:00Z' },
      {
        role: 'assistant',
        content: 'hello',
        timestamp: '2026-07-28T00:00:01Z',
        usage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0 },
        usageModel: 'claude-opus-5',
      },
    ];
    const { container } = renderComposer({ messages });
    const badge = container.querySelector('.composer-cost');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain('tok');
  });

  it('no cost badge renders before any turn reports usage', () => {
    const { container } = renderComposer();
    expect(container.querySelector('.composer-cost')).toBeNull();
  });

  it('typing a bare "/" opens the slash launcher with the reserved built-ins', async () => {
    const { textarea, getByText, container } = renderComposer();
    await fireEvent.input(textarea, { target: { value: '/' } });
    expect(container.querySelector('.slash-menu')).toBeTruthy();
    expect(getByText('/clear')).toBeTruthy();
    expect(getByText('/compact')).toBeTruthy();
  });

  it('⏎ in the open slash menu runs the highlighted built-in and does not send', async () => {
    const { textarea } = renderComposer();
    await fireEvent.input(textarea, { target: { value: '/' } });
    await fireEvent.keyDown(textarea, { key: 'Enter' });
    // First built-in alphabetically is `clear`.
    expect(runBuiltinCommand).toHaveBeenCalledWith('clear');
    expect(send).not.toHaveBeenCalled();
  });

  it('ArrowDown moves the slash selection to the second built-in before Enter selects it', async () => {
    const { textarea } = renderComposer();
    await fireEvent.input(textarea, { target: { value: '/' } });
    await fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    await fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(runBuiltinCommand).toHaveBeenCalledWith('compact');
  });
});
