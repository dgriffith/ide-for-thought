/**
 * @vitest-environment happy-dom
 *
 * Render + rune-reactivity coverage for BreadcrumbsBar (#476, #1002). The
 * folder crumbs + leaf name are a `$derived.by` off the `filePath` prop, so
 * the headline risk is a stale derivation: the bar keeps showing the old
 * path's segments after the active file changes. These tests re-render with a
 * new `filePath` and assert the crumbs track it, plus pin the click-to-reveal
 * callback contract and the null/root/deep edge cases.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import BreadcrumbsBar from '../../../src/renderer/lib/components/BreadcrumbsBar.svelte';

afterEach(cleanup);

function baseProps(over: Record<string, unknown> = {}) {
  return {
    filePath: 'notes/sub/deep.md',
    content: '',
    cursorLine: 1,
    showHeadings: false,
    onRevealFolder: vi.fn(),
    onScrollToLine: vi.fn(),
    ...over,
  };
}

/** Folder crumbs are the only <button>s on the bar (the leaf is a span). */
function folderLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button.crumb.folder')).map(
    (b) => b.textContent?.trim() ?? '',
  );
}

describe('BreadcrumbsBar (#1002)', () => {
  it('renders each folder as a clickable crumb and the note leaf (extension stripped)', () => {
    const { container, getByText } = render(BreadcrumbsBar, baseProps());
    expect(folderLabels(container)).toEqual(['notes', 'sub']);
    // Leaf drops the `.md` and is the current-page marker, not a button.
    const leaf = getByText('deep');
    expect(leaf.tagName).toBe('SPAN');
    expect(leaf.getAttribute('aria-current')).toBe('page');
  });

  it('re-derives the crumbs when filePath changes (stale $derived guard)', async () => {
    const { container, rerender, getByText, queryByText } = render(
      BreadcrumbsBar,
      baseProps({ filePath: 'notes/sub/deep.md' }),
    );
    expect(folderLabels(container)).toEqual(['notes', 'sub']);
    expect(getByText('deep')).toBeTruthy();

    await rerender(baseProps({ filePath: 'research/paper.md' }));

    // Old segments are gone, new ones are present — no stale derivation.
    expect(folderLabels(container)).toEqual(['research']);
    expect(getByText('paper')).toBeTruthy();
    expect(queryByText('deep')).toBeNull();
    expect(queryByText('sub')).toBeNull();
  });

  it('clicking a folder crumb reveals its accumulated path from root', async () => {
    const onRevealFolder = vi.fn();
    const { getByText } = render(
      BreadcrumbsBar,
      baseProps({ filePath: 'notes/sub/deep.md', onRevealFolder }),
    );
    await fireEvent.click(getByText('sub'));
    // `sub` sits under `notes`, so the reveal target is the full path.
    expect(onRevealFolder).toHaveBeenCalledWith('notes/sub');

    await fireEvent.click(getByText('notes'));
    expect(onRevealFolder).toHaveBeenCalledWith('notes');
  });

  it('root-level file renders just the leaf with no folder crumbs', () => {
    const { container, getByText } = render(
      BreadcrumbsBar,
      baseProps({ filePath: 'readme.md' }),
    );
    expect(folderLabels(container)).toEqual([]);
    expect(getByText('readme')).toBeTruthy();
  });

  it('renders nothing when there is no active file', () => {
    const { container } = render(BreadcrumbsBar, baseProps({ filePath: null }));
    expect(container.querySelector('nav.breadcrumbs')).toBeNull();
  });

  it('reactively appears when a file opens and disappears when it closes', async () => {
    const { container, rerender } = render(
      BreadcrumbsBar,
      baseProps({ filePath: null }),
    );
    expect(container.querySelector('nav.breadcrumbs')).toBeNull();

    await rerender(baseProps({ filePath: 'a/b.md' }));
    expect(container.querySelector('nav.breadcrumbs')).not.toBeNull();
    expect(folderLabels(container)).toEqual(['a']);

    await rerender(baseProps({ filePath: null }));
    expect(container.querySelector('nav.breadcrumbs')).toBeNull();
  });

  it('renders every ancestor of a deeply nested path as its own crumb', () => {
    const { container, getByText } = render(
      BreadcrumbsBar,
      baseProps({ filePath: 'a/b/c/d/e/leaf.md' }),
    );
    expect(folderLabels(container)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(getByText('leaf')).toBeTruthy();
  });
});
