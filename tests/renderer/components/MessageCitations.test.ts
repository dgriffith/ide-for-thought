/**
 * @vitest-environment happy-dom
 *
 * Render coverage for MessageCitations (#672) — the citation list extracted
 * from ConversationsPanel. Pins the markup (numbered external links + host)
 * and the cite-action state machine: disabled with no target, "citing…" while
 * running, "✓ cited" when done, "retry" on error — and the onCite /
 * onOpenExternal callbacks the panel relies on.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { Citation } from '../../../src/shared/types';
import type { CiteStatus } from '../../../src/renderer/lib/conversations/citations';
import MessageCitations from '../../../src/renderer/lib/components/MessageCitations.svelte';

const cites: Citation[] = [
  { url: 'https://www.nature.com/articles/x', title: 'A Nature paper', citedText: 'quoted bit' },
  { url: 'https://example.org/blog', title: null, citedText: null },
];

function renderList(over: {
  targetPath?: string | null;
  state?: Record<number, CiteStatus>;
  onCite?: (ci: number, c: Citation) => void;
  onOpenExternal?: (url: string) => void;
} = {}) {
  const state = over.state ?? {};
  return render(MessageCitations, {
    citations: cites,
    targetPath: 'targetPath' in over ? over.targetPath! : 'notes/active.md',
    citeStateFor: (ci: number) => state[ci],
    onOpenExternal: over.onOpenExternal ?? vi.fn(),
    onCite: over.onCite ?? vi.fn(),
  });
}

afterEach(cleanup);

describe('MessageCitations (#672)', () => {
  it('renders numbered citations with title (or host fallback) and host label', () => {
    const { getByText } = renderList();
    expect(getByText('[1]')).toBeTruthy();
    expect(getByText('A Nature paper')).toBeTruthy();
    // Second citation has no title → falls back to the host.
    expect(getByText('[2]')).toBeTruthy();
    // host label appears for both (nature.com once as host; example.org as both title-fallback and host)
    expect(getByText('nature.com')).toBeTruthy();
  });

  it('clicking a citation link opens it externally', async () => {
    const onOpenExternal = vi.fn();
    const { getAllByRole } = renderList({ onOpenExternal });
    // The first button in each <li> is the citation link.
    await fireEvent.click(getAllByRole('button')[0]);
    expect(onOpenExternal).toHaveBeenCalledWith('https://www.nature.com/articles/x');
  });

  it('the cite action is enabled with a target and reports onCite with index + citation', async () => {
    const onCite = vi.fn();
    const { getAllByText } = renderList({ targetPath: 'notes/active.md', onCite });
    await fireEvent.click(getAllByText('cite')[0]);
    expect(onCite).toHaveBeenCalledWith(0, cites[0]);
  });

  it('the cite action is disabled when there is no target note', () => {
    const { getAllByText } = renderList({ targetPath: null });
    const buttons = getAllByText('cite').map((el) => el.closest('button')!);
    for (const b of buttons) expect(b.disabled).toBe(true);
  });

  it('shows "citing…" while running and "✓ cited" when done', () => {
    const { getByText, getAllByText } = renderList({
      state: { 0: { phase: 'running' }, 1: { phase: 'done' } },
    });
    expect(getAllByText('citing…').length).toBeGreaterThan(0);
    expect(getByText('✓ cited')).toBeTruthy();
  });

  it('shows a "retry" action carrying the error message, and retry re-fires onCite', async () => {
    const onCite = vi.fn();
    const { getByText, getByTitle } = renderList({
      state: { 0: { phase: 'error', message: 'ingest failed: 500' } },
      onCite,
    });
    expect(getByTitle('ingest failed: 500')).toBeTruthy();
    await fireEvent.click(getByText('retry'));
    expect(onCite).toHaveBeenCalledWith(0, cites[0]);
  });
});
