/**
 * @vitest-environment happy-dom
 *
 * Render + interaction coverage for the conversation MessageList (~0% covered).
 * Renders the real transcript component with representative
 * `ConversationMessage[]` and asserts the visible DOM: each turn's role label
 * (user turns keep their role, the assistant turn is relabelled "Minerva"),
 * markdown-rendered assistant prose, system turns hidden, an assistant turn's
 * citations (via the real MessageCitations child), the per-turn usage/cost
 * line (present only when a turn reports usage), the streaming "thinking"
 * interstitial, and the ask-user card whose choice/Reply actions call
 * `store.answerQuestion`.
 *
 * The conversations / editor / notebase / source-data stores and the IPC
 * client are mocked; markdown-it and MessageCitations run for real. With no
 * drafts on the tab the DraftCards child renders nothing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { ConversationMessage, Citation } from '../../../../src/shared/types';
import type { AskUserRequest } from '../../../../src/shared/conversation-tools';

// ── Store + IPC mocks ─────────────────────────────────────────────────────
const answerQuestion = vi.fn();

vi.mock('../../../../src/renderer/lib/stores/conversations.svelte', () => ({
  getConversationsStore: () => ({
    answerQuestion,
    // Draft approve/discard methods DraftCards would call — never reached here
    // because the fixture tab carries no drafts, but present so the child mounts.
    approveDraft: vi.fn(),
    discardDraft: vi.fn(),
  }),
}));

vi.mock('../../../../src/renderer/lib/stores/editor.svelte', () => ({
  getEditorStore: () => ({
    activeFilePath: null,
    save: vi.fn(),
    reloadTabFromDisk: vi.fn(),
  }),
}));

vi.mock('../../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => ({ writeFile: vi.fn() }),
}));

vi.mock('../../../../src/renderer/lib/stores/source-data.svelte', () => ({
  getSourceDataStore: () => ({ ingestUrl: vi.fn() }),
}));

vi.mock('../../../../src/renderer/lib/ipc/client', () => ({
  api: {
    shell: { openExternal: vi.fn() },
    notebase: { readFile: vi.fn() },
  },
}));

import MessageList from '../../../../src/renderer/lib/components/conversations/MessageList.svelte';

afterEach(cleanup);

type TabLike = Record<string, unknown>;

function makeTab(over: {
  messages?: ConversationMessage[];
  streaming?: boolean;
  streamedChunks?: string;
  pendingQuestion?: AskUserRequest | null;
  notePath?: string | null;
} = {}): TabLike {
  return {
    id: 'tab-1',
    title: null,
    composer: '',
    streaming: over.streaming ?? false,
    streamedChunks: over.streamedChunks ?? '',
    pendingQuestion: over.pendingQuestion ?? null,
    extraTools: [],
    // Every draft collection empty → DraftCards renders nothing.
    drafts: [],
    sourceDrafts: [],
    sourceDraftResults: {},
    noteDraftResults: {},
    propertyDrafts: [],
    propertyDraftResults: {},
    sourcePropertyDrafts: [],
    sourcePropertyDraftResults: {},
    claimsDrafts: [],
    claimsDraftResults: {},
    computeDrafts: [],
    refactorDrafts: [],
    reorgDrafts: [],
    deleteDrafts: [],
    noteBodyDrafts: [],
    computeDraftState: {},
    conversation: {
      messages: over.messages ?? [],
      contextBundle: { notePath: over.notePath ?? null },
    },
  };
}

function renderList(over: Parameters<typeof makeTab>[0] & { currentNotePath?: string | null } = {}) {
  const { currentNotePath, ...tabOver } = over;
  return render(MessageList, {
    tab: makeTab(tabOver) as never,
    currentNotePath: currentNotePath ?? null,
  });
}

const ts = '2026-07-28T00:00:00Z';

describe('MessageList — render + interaction (~0% covered)', () => {
  it('renders a user turn (role kept) and an assistant turn (relabelled "Minerva") with markdown', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hello there', timestamp: ts },
      { role: 'assistant', content: 'Hi **friend**', timestamp: ts },
    ];
    const { getByText, container } = renderList({ messages });

    expect(getByText('Hello there')).toBeTruthy();
    // User role label is the raw role; assistant is presented as "Minerva".
    expect(getByText('user')).toBeTruthy();
    expect(getByText('Minerva')).toBeTruthy();
    // Assistant prose is markdown-rendered → **friend** becomes <strong>.
    const strong = container.querySelector('.msg.assistant .msg-content strong');
    expect(strong?.textContent).toBe('friend');
  });

  it('does not render system turns', () => {
    const messages: ConversationMessage[] = [
      { role: 'system', content: 'SECRET SYSTEM PROMPT', timestamp: ts },
      { role: 'user', content: 'visible question', timestamp: ts },
    ];
    const { queryByText, getByText } = renderList({ messages });
    expect(getByText('visible question')).toBeTruthy();
    expect(queryByText('SECRET SYSTEM PROMPT')).toBeNull();
  });

  it('renders an assistant turn\'s citations through MessageCitations', () => {
    const citations: Citation[] = [
      { url: 'https://www.nature.com/articles/x', title: 'A Nature paper', citedText: 'quoted' },
    ];
    const messages: ConversationMessage[] = [
      { role: 'assistant', content: 'See the paper.', timestamp: ts, citations },
    ];
    const { getByText } = renderList({ messages, currentNotePath: 'notes/active.md' });
    expect(getByText('[1]')).toBeTruthy();
    expect(getByText('A Nature paper')).toBeTruthy();
    expect(getByText('nature.com')).toBeTruthy();
  });

  it('shows the per-turn cost line when the assistant turn reports usage', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content: 'answer',
        timestamp: ts,
        usage: { inputTokens: 2000, outputTokens: 1000, cacheCreationTokens: 0, cacheReadTokens: 0 },
        usageModel: 'claude-opus-5',
      },
    ];
    const { container } = renderList({ messages });
    const cost = container.querySelector('.msg.assistant .msg-cost');
    expect(cost).toBeTruthy();
    expect(cost?.getAttribute('title')).toBe('Token usage / cost for this turn');
    expect(cost?.textContent).toContain('tok');
  });

  it('omits the cost line for an assistant turn with no usage', () => {
    const messages: ConversationMessage[] = [
      { role: 'assistant', content: 'no usage here', timestamp: ts },
    ];
    const { container } = renderList({ messages });
    expect(container.querySelector('.msg-cost')).toBeNull();
  });

  it('renders the streaming block with partial text and the "thinking" interstitial', () => {
    const { container, getByLabelText } = renderList({
      streaming: true,
      streamedChunks: 'partial answer so far',
    });
    expect(getByLabelText('Thinking')).toBeTruthy();
    const streaming = container.querySelector('.msg.assistant.streaming .msg-content');
    expect(streaming?.textContent).toContain('partial answer so far');
  });

  it('renders the ask-user card; clicking a choice calls store.answerQuestion with the tab id + choice', async () => {
    answerQuestion.mockClear();
    const pendingQuestion: AskUserRequest = {
      questionId: 'q1',
      question: 'Which direction?',
      choices: ['Left', 'Right'],
    };
    const { getByText } = renderList({ pendingQuestion });

    expect(getByText('Which direction?')).toBeTruthy();
    await fireEvent.click(getByText('Left'));
    expect(answerQuestion).toHaveBeenCalledWith('tab-1', 'Left');
  });

  it('the ask-user Reply button is disabled until an answer is typed, then submits it', async () => {
    answerQuestion.mockClear();
    const pendingQuestion: AskUserRequest = { questionId: 'q2', question: 'Free text?' };
    const { getByText, getByPlaceholderText } = renderList({ pendingQuestion });

    const reply = getByText('Reply').closest('button') as HTMLButtonElement;
    expect(reply.disabled).toBe(true);

    const input = getByPlaceholderText('Type your answer (Enter to send)');
    await fireEvent.input(input, { target: { value: 'my answer' } });
    expect(reply.disabled).toBe(false);

    await fireEvent.click(reply);
    expect(answerQuestion).toHaveBeenCalledWith('tab-1', 'my answer');
  });
});
