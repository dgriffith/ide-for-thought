/**
 * @vitest-environment happy-dom
 *
 * Render coverage for ComputeDraftCard (#672) — the propose_compute review
 * card extracted from ConversationsPanel. Pins the card's behavior: it renders
 * the proposal, enforces the risky-Python "click Run twice" confirmation, folds
 * edited code into Run, and routes Run / Insert / Discard / open-inserted back
 * to the panel. The run state (running / result / insertedAt) is passed in.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { ConversationComputeDraft } from '../../../src/shared/conversation-compute-drafts';
import type { CellResult } from '../../../src/shared/compute/types';
import ComputeDraftCard from '../../../src/renderer/lib/components/ComputeDraftCard.svelte';

function draft(over: Partial<ConversationComputeDraft> = {}): ConversationComputeDraft {
  return {
    draftId: 'd1',
    conversationId: 'c1',
    language: 'python',
    code: 'print(1 + 1)',
    rationale: 'Compute the answer',
    safetyFlags: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function renderCard(over: {
  draft?: ConversationComputeDraft;
  runState?: { running: boolean; result: CellResult | null; insertedAt: string | null };
  onRun?: (d: ConversationComputeDraft, edited: string | undefined) => void;
  onInsert?: (d: ConversationComputeDraft, edited: string | undefined) => void;
  onDiscard?: (d: ConversationComputeDraft) => void;
  onOpenInserted?: (p: string) => void;
} = {}) {
  return render(ComputeDraftCard, {
    draft: over.draft ?? draft(),
    runState: over.runState,
    onRun: over.onRun ?? vi.fn(),
    onInsert: over.onInsert ?? vi.fn(),
    onDiscard: over.onDiscard ?? vi.fn(),
    onOpenInserted: over.onOpenInserted ?? vi.fn(),
  });
}

afterEach(cleanup);

describe('ComputeDraftCard (#672)', () => {
  it('renders the language pill, rationale, and code', () => {
    const { getByText } = renderCard();
    expect(getByText('Python')).toBeTruthy();
    expect(getByText('Compute the answer')).toBeTruthy();
    expect(getByText('print(1 + 1)')).toBeTruthy();
  });

  it('Run executes immediately when there are no safety flags', async () => {
    const onRun = vi.fn();
    const d = draft({ safetyFlags: [] });
    const { getByText } = renderCard({ draft: d, onRun });
    await fireEvent.click(getByText('Run'));
    expect(onRun).toHaveBeenCalledWith(d, undefined);
  });

  it('a risky cell arms on the first Run click and only executes on the second', async () => {
    const onRun = vi.fn();
    const d = draft({ safetyFlags: [{ id: 'f1', message: 'uses os.system' }] });
    const { getByText } = renderCard({ draft: d, onRun });

    await fireEvent.click(getByText('Run'));
    expect(onRun).not.toHaveBeenCalled();             // armed, not run
    expect(getByText('Run anyway')).toBeTruthy();
    expect(getByText(/Click Run again to confirm/)).toBeTruthy();

    await fireEvent.click(getByText('Run anyway'));
    expect(onRun).toHaveBeenCalledWith(d, undefined); // second click executes
  });

  it('Edit folds the edited code into the next Run', async () => {
    const onRun = vi.fn();
    const d = draft({ code: 'print(1)' });
    const { getByText, getByRole } = renderCard({ draft: d, onRun });

    await fireEvent.click(getByText('Edit'));
    await fireEvent.input(getByRole('textbox'), { target: { value: 'print(2)' } });
    await fireEvent.click(getByText('Done'));
    await fireEvent.click(getByText('Run'));

    expect(onRun).toHaveBeenCalledWith(d, 'print(2)');
  });

  it('Insert reports onInsert and Discard reports onDiscard', async () => {
    const onInsert = vi.fn();
    const onDiscard = vi.fn();
    const d = draft();
    const { getByText } = renderCard({ draft: d, onInsert, onDiscard });

    await fireEvent.click(getByText('Insert into notebook'));
    expect(onInsert).toHaveBeenCalledWith(d, undefined);

    await fireEvent.click(getByText('Discard'));
    expect(onDiscard).toHaveBeenCalledWith(d);
  });

  it('disables Run and shows "Running…" while a run is in flight', () => {
    const { getByText } = renderCard({ runState: { running: true, result: null, insertedAt: null } });
    const btn = getByText('Running…').closest('button')!;
    expect(btn.disabled).toBe(true);
  });

  it('renders an error result', () => {
    const { getByText } = renderCard({
      runState: { running: false, result: { ok: false, error: 'NameError: x' }, insertedAt: null },
    });
    expect(getByText(/NameError: x/)).toBeTruthy();
  });

  it('renders a table result via formatComputeCell', () => {
    const result: CellResult = {
      ok: true,
      output: { type: 'table', columns: ['a', 'b'], rows: [[1, 'x']], truncated: false, totalRows: 1 },
    };
    const { getByText } = renderCard({ runState: { running: false, result, insertedAt: null } });
    expect(getByText('a')).toBeTruthy();
    expect(getByText('x')).toBeTruthy();
  });

  it('shows the "filed as a cell" link and opens it', async () => {
    const onOpenInserted = vi.fn();
    const { getByText } = renderCard({
      runState: { running: false, result: null, insertedAt: 'notes/sub/analysis.md' },
      onOpenInserted,
    });
    const link = getByText('analysis.md'); // basename of the inserted path
    await fireEvent.click(link);
    expect(onOpenInserted).toHaveBeenCalledWith('notes/sub/analysis.md');
  });
});
