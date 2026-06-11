/**
 * @vitest-environment happy-dom
 *
 * Render coverage for DraftCard (#672) — the shared shell behind the five
 * simple conversation draft-approval cards (note / source / property /
 * source-property / claims). Pins the chrome and the Trust action row: the
 * headline + note render, the card body is projected, and the Approve / Discard
 * buttons report back to the panel.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DraftCard from '../../../src/renderer/lib/components/DraftCard.svelte';

const body = createRawSnippet(() => ({
  render: () => '<div data-testid="card-body">body content</div>',
}));

function renderCard(over: { onApprove?: () => void; onDiscard?: () => void; approveLabel?: string } = {}) {
  return render(DraftCard, {
    headline: '📚 2 sources',
    note: 'Found two papers to file',
    approveLabel: over.approveLabel ?? 'Approve & ingest',
    onApprove: over.onApprove ?? vi.fn(),
    onDiscard: over.onDiscard ?? vi.fn(),
    children: body,
  });
}

afterEach(cleanup);

describe('DraftCard (#672)', () => {
  it('renders the headline, note, and the projected body', () => {
    const { getByText, getByTestId } = renderCard();
    expect(getByText('📚 2 sources')).toBeTruthy();
    expect(getByText('Found two papers to file')).toBeTruthy();
    expect(getByTestId('card-body').textContent).toBe('body content');
  });

  it('uses the caller-supplied approve label', () => {
    const { getByText } = renderCard({ approveLabel: 'Approve & file' });
    expect(getByText('Approve & file')).toBeTruthy();
  });

  it('Approve fires onApprove', async () => {
    const onApprove = vi.fn();
    const { getByText } = renderCard({ onApprove, approveLabel: 'Approve & apply' });
    await fireEvent.click(getByText('Approve & apply'));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('Discard fires onDiscard', async () => {
    const onDiscard = vi.fn();
    const { getByText } = renderCard({ onDiscard });
    await fireEvent.click(getByText('Discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
