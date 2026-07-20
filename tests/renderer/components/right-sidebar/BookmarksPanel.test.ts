/**
 * @vitest-environment happy-dom
 *
 * Right-sidebar BookmarksPanel open-routing (#755). Section bookmarks (those
 * with an `anchor`) open via `onNavigate('path#slug')` so navigation scrolls
 * to the heading; whole-file bookmarks still open via `onFileSelect(path)`.
 * The store is mocked so we control the tree without touching IPC.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { BookmarkNode } from '../../../../src/shared/types';

const { treeRef } = vi.hoisted(() => ({ treeRef: { current: [] as BookmarkNode[] } }));
// Keep the real `collectNoteBookmarksWithFolder` (pure) — override only the store.
vi.mock('../../../../src/renderer/lib/stores/bookmarks.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../../../../src/renderer/lib/stores/bookmarks.svelte')>();
  return {
    ...actual,
    getBookmarksStore: () => ({
      get tree() { return treeRef.current; },
      remove: vi.fn(),
    }),
  };
});

import BookmarksPanel from '../../../../src/renderer/lib/components/right-sidebar/BookmarksPanel.svelte';

afterEach(() => { cleanup(); treeRef.current = []; });

const ACTIVE = 'journey/raft.md';

describe('right-sidebar BookmarksPanel (#755)', () => {
  it('opens a whole-file bookmark via onFileSelect', async () => {
    treeRef.current = [
      { type: 'bookmark', id: 'a', name: 'raft', relativePath: ACTIVE },
    ];
    const onFileSelect = vi.fn();
    const onNavigate = vi.fn();
    const { getByText } = render(BookmarksPanel, { activeFilePath: ACTIVE, onFileSelect, onNavigate });

    await fireEvent.click(getByText('raft'));
    expect(onFileSelect).toHaveBeenCalledWith(ACTIVE);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('opens a section bookmark via onNavigate(path#slug)', async () => {
    treeRef.current = [
      { type: 'bookmark', id: 'b', name: 'Methods', relativePath: ACTIVE, anchor: 'methods' },
    ];
    const onFileSelect = vi.fn();
    const onNavigate = vi.fn();
    const { getByText } = render(BookmarksPanel, { activeFilePath: ACTIVE, onFileSelect, onNavigate });

    await fireEvent.click(getByText('Methods'));
    expect(onNavigate).toHaveBeenCalledWith(`${ACTIVE}#methods`);
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('falls back to onFileSelect for a section bookmark when onNavigate is absent', async () => {
    treeRef.current = [
      { type: 'bookmark', id: 'c', name: 'Methods', relativePath: ACTIVE, anchor: 'methods' },
    ];
    const onFileSelect = vi.fn();
    const { getByText } = render(BookmarksPanel, { activeFilePath: ACTIVE, onFileSelect });

    await fireEvent.click(getByText('Methods'));
    expect(onFileSelect).toHaveBeenCalledWith(ACTIVE);
  });

  it('opens a line bookmark via onOpenAtOffset(path, offset)', async () => {
    treeRef.current = [
      { type: 'bookmark', id: 'd', name: 'some line', relativePath: ACTIVE, cursorOffset: 142 },
    ];
    const onFileSelect = vi.fn();
    const onNavigate = vi.fn();
    const onOpenAtOffset = vi.fn();
    const { getByText } = render(BookmarksPanel, {
      activeFilePath: ACTIVE, onFileSelect, onNavigate, onOpenAtOffset,
    });

    await fireEvent.click(getByText('some line'));
    expect(onOpenAtOffset).toHaveBeenCalledWith(ACTIVE, 142);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('shows the containing-folder path for a nested bookmark, and none for a root one', () => {
    treeRef.current = [
      { type: 'bookmark', id: 'root', name: 'Top', relativePath: ACTIVE },
      {
        type: 'folder', id: 'f1', name: 'Research', children: [
          {
            type: 'folder', id: 'f2', name: 'Papers', children: [
              { type: 'bookmark', id: 'deep', name: 'Deep one', relativePath: ACTIVE },
            ],
          },
        ],
      },
    ];
    const { getByText, queryAllByText } = render(BookmarksPanel, {
      activeFilePath: ACTIVE, onFileSelect: vi.fn(),
    });
    // The nested bookmark shows its folder path; the root one shows no folder.
    expect(getByText('Research / Papers')).toBeTruthy();
    expect(queryAllByText(/Research/)).toHaveLength(1);
    expect(getByText('Top')).toBeTruthy();
  });

  it('prefers the section anchor over a stored offset when both are present', async () => {
    treeRef.current = [
      { type: 'bookmark', id: 'e', name: 'Methods', relativePath: ACTIVE, anchor: 'methods', cursorOffset: 5 },
    ];
    const onNavigate = vi.fn();
    const onOpenAtOffset = vi.fn();
    const { getByText } = render(BookmarksPanel, {
      activeFilePath: ACTIVE, onFileSelect: vi.fn(), onNavigate, onOpenAtOffset,
    });

    await fireEvent.click(getByText('Methods'));
    expect(onNavigate).toHaveBeenCalledWith(`${ACTIVE}#methods`);
    expect(onOpenAtOffset).not.toHaveBeenCalled();
  });
});
