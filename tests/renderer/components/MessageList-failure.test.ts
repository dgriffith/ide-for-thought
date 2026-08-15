/**
 * @vitest-environment happy-dom
 *
 * The inline failed-turn block in the conversation transcript (#1804).
 *
 * The store tests assert that a failure is *recorded*; this asserts it is
 * actually *shown* — the whole point of the change, since the old behaviour
 * recorded nothing and rendered nothing. Mounts the real MessageList with a
 * hand-built tab and checks what a user would see: the message, the preserved
 * partial reply, and only the actions that make sense for that failure kind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/svelte';
import type { TabRuntime, TabFailure } from '../../../src/renderer/lib/stores/conversations.svelte';

const h = vi.hoisted(() => ({
  retryLastTurn: vi.fn(),
  dismissFailure: vi.fn(),
  runBuiltinCommand: vi.fn(),
  answerQuestion: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({
  getConversationsStore: () => ({
    retryLastTurn: h.retryLastTurn,
    dismissFailure: h.dismissFailure,
    runBuiltinCommand: h.runBuiltinCommand,
    answerQuestion: h.answerQuestion,
  }),
}));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({
  getEditorStore: () => ({ activeFilePath: null, save: vi.fn(), reloadTabFromDisk: vi.fn() }),
}));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => ({ writeFile: vi.fn() }),
}));
vi.mock('../../../src/renderer/lib/stores/source-data.svelte', () => ({
  getSourceDataStore: () => ({ ingestUrl: vi.fn() }),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { shell: { openExternal: vi.fn() }, notebase: { readFile: vi.fn() } },
}));

import MessageList from '../../../src/renderer/lib/components/conversations/MessageList.svelte';

function tabWith(failure: TabFailure | null, streaming = false): TabRuntime {
  return {
    id: 'tab-1',
    title: null,
    conversation: {
      id: 'conv-1',
      contextBundle: {},
      messages: [{ role: 'user', content: 'summarise this note', timestamp: 't' }],
      status: 'active',
      startedAt: 't',
    },
    drafts: [], sourceDrafts: [], sourceDraftResults: {}, noteDraftResults: {},
    propertyDrafts: [], propertyDraftResults: {}, sourcePropertyDrafts: [],
    sourcePropertyDraftResults: {}, claimsDrafts: [], claimsDraftResults: {},
    computeDrafts: [], refactorDrafts: [], reorgDrafts: [], deleteDrafts: [],
    noteBodyDrafts: [], computeDraftState: {}, pendingQuestion: null,
    composer: '', streaming, streamedChunks: '', failure, extraTools: [],
  } as unknown as TabRuntime;
}

const failure = (over: Partial<TabFailure> = {}): TabFailure => ({
  kind: 'overloaded',
  message: 'Anthropic is overloaded right now. This is temporary.',
  retryable: true,
  partial: '',
  afterMessageIndex: 1,
  ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('failed turn, rendered inline (#1804)', () => {
  it('shows nothing at all when there is no failure', () => {
    render(MessageList, { props: { tab: tabWith(null), currentNotePath: null } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the classified message where the reply would have been', () => {
    render(MessageList, { props: { tab: tabWith(failure()), currentNotePath: null } });
    expect(screen.getByText(/Anthropic is overloaded right now/)).toBeTruthy();
  });

  it('keeps the text that streamed before the failure', () => {
    render(MessageList, {
      props: {
        tab: tabWith(failure({ partial: 'The note argues that large republics' })),
        currentNotePath: null,
      },
    });
    // A turn that died three paragraphs in still wrote three useful paragraphs.
    expect(screen.getByText(/The note argues that large republics/)).toBeTruthy();
  });

  it('offers Retry for a temporary failure and wires it to the store', async () => {
    render(MessageList, { props: { tab: tabWith(failure()), currentNotePath: 'notes/a.md' } });
    const retry = screen.getByRole('button', { name: 'Retry' });

    await fireEvent.click(retry);

    expect(h.retryLastTurn).toHaveBeenCalledWith('tab-1', 'notes/a.md');
  });

  it('does NOT offer Retry when retrying cannot help', () => {
    // An exhausted balance is the case that matters: a Retry button here is an
    // invitation to bang on a door that will not open.
    render(MessageList, {
      props: {
        tab: tabWith(failure({ kind: 'quota', retryable: false, message: 'Out of credit.' })),
        currentNotePath: null,
      },
    });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByText('Out of credit.')).toBeTruthy();
  });

  it('offers /compact when the conversation outgrew the context window', async () => {
    render(MessageList, {
      props: {
        tab: tabWith(failure({ kind: 'context_length', retryable: false, message: 'Too long.' })),
        currentNotePath: null,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Run /compact' }));

    expect(h.runBuiltinCommand).toHaveBeenCalledWith('compact');
  });

  it('can be dismissed', async () => {
    render(MessageList, { props: { tab: tabWith(failure()), currentNotePath: null } });
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(h.dismissFailure).toHaveBeenCalledWith('tab-1');
  });

  it('renders a stopped turn without the warning glyph (#1809)', () => {
    // A cancelled turn reuses this block to keep its partial text, but the user
    // pressing Stop is not a problem being reported back at them — no alarm.
    const stopped = failure({
      kind: 'cancelled',
      retryable: false,
      message: 'Stopped. This partial reply wasn\'t saved to the conversation.',
      partial: 'The note argues that large republics',
    });
    const { container } = render(MessageList, {
      props: { tab: tabWith(stopped), currentNotePath: null },
    });

    expect(screen.getByText(/The note argues that large republics/)).toBeTruthy();
    expect(screen.getByText(/Stopped\./)).toBeTruthy();
    expect(container.querySelector('.turn-error-icon')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('yields to the streaming indicator while a new turn is in flight', () => {
    // Retrying shouldn't leave the old error sitting under a live spinner.
    render(MessageList, { props: { tab: tabWith(failure(), true), currentNotePath: null } });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
