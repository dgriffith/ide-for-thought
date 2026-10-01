/**
 * @vitest-environment happy-dom
 *
 * The turn-status line: a verb and a ticking elapsed time while a reply is in
 * flight, and none of it read aloud every second.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import TurnStatus from '../../../src/renderer/lib/components/conversations/TurnStatus.svelte';
import { TURN_VERBS, VERB_ROTATE_MS, verbOffsetFor } from '../../../src/renderer/lib/conversations/turn-status';

const START = 1_790_000_000_000;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TurnStatus', () => {
  it('shows the elapsed time, ticking each second', async () => {
    render(TurnStatus, { startedAt: START });
    expect(screen.getByText('0s')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(65_000);
    expect(screen.getByText('1m 05s')).toBeTruthy();
  });

  it('rotates its verb as the wait goes on', async () => {
    render(TurnStatus, { startedAt: START });
    const off = verbOffsetFor(START);
    expect(screen.getByText(`${TURN_VERBS[off % TURN_VERBS.length]}…`)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(VERB_ROTATE_MS);
    expect(screen.getByText(`${TURN_VERBS[(off + 1) % TURN_VERBS.length]}…`)).toBeTruthy();
  });

  it('keeps counting from the turn start, not from when it was mounted (switching tabs back)', () => {
    vi.setSystemTime(START + 42_000);
    render(TurnStatus, { startedAt: START });
    expect(screen.getByText('42s')).toBeTruthy();
  });

  it('is one static status for a screen reader: the ticking text is hidden', () => {
    render(TurnStatus, { startedAt: START });
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-label')).toBe('Thinking');
    expect(status.querySelector('.turn-status-text')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows just the dots with no start time', () => {
    const { container } = render(TurnStatus, { startedAt: null });
    expect(container.querySelectorAll('.thinking-dot')).toHaveLength(3);
    expect(container.querySelector('.turn-status-text')).toBeNull();
  });
});
