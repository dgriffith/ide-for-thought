/**
 * resolveBookmarkOffsets — maps a file's bookmarks to gutter-flag offsets:
 * line bookmarks by stored offset, section bookmarks by heading slug, and
 * whole-note bookmarks to line 1.
 */

import { describe, it, expect, vi } from 'vitest';

// collectBookmarksForPath lives in the bookmarks store module, which pulls
// in the IPC client (window.api) at load — mock it so this can run headless.
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { bookmarks: { save: vi.fn(), load: vi.fn() } },
}));

import { resolveBookmarkOffsets } from '../../../src/renderer/lib/editor/bookmark-gutter';
import { collectBookmarksForPath } from '../../../src/renderer/lib/stores/bookmarks.svelte';
import type { BookmarkNode } from '../../../src/shared/types';

const DOC = '# Title\n\nsome\n## Section\nbody';
//            0……7  8   9.. 13 14……….24 25

describe('resolveBookmarkOffsets', () => {
  it('returns [] for no bookmarks', () => {
    expect(resolveBookmarkOffsets(DOC, [])).toEqual([]);
  });

  it('uses the stored cursorOffset for a line bookmark', () => {
    expect(resolveBookmarkOffsets(DOC, [{ cursorOffset: 11 }])).toEqual([11]);
  });

  it('clamps an out-of-range cursorOffset into the document', () => {
    expect(resolveBookmarkOffsets(DOC, [{ cursorOffset: 9999 }])).toEqual([DOC.length]);
    expect(resolveBookmarkOffsets(DOC, [{ cursorOffset: -5 }])).toEqual([0]);
  });

  it('resolves a section anchor to its heading line start', () => {
    expect(resolveBookmarkOffsets(DOC, [{ anchor: 'section' }])).toEqual([14]);
    expect(resolveBookmarkOffsets(DOC, [{ anchor: 'title' }])).toEqual([0]);
  });

  it('drops a section anchor that matches no heading', () => {
    expect(resolveBookmarkOffsets(DOC, [{ anchor: 'nope' }])).toEqual([]);
  });

  it('flags line 1 for a whole-note bookmark (no offset, no anchor)', () => {
    expect(resolveBookmarkOffsets(DOC, [{}])).toEqual([0]);
  });

  it('deduplicates offsets that land on the same spot', () => {
    expect(resolveBookmarkOffsets(DOC, [{ anchor: 'title' }, {}, { cursorOffset: 0 }])).toEqual([0]);
  });
});

describe('collectBookmarksForPath', () => {
  const tree: BookmarkNode[] = [
    { type: 'bookmark', id: '1', name: 'A', relativePath: 'a.md', cursorOffset: 5 },
    { type: 'bookmark', id: '2', name: 'B', relativePath: 'b.md', anchor: 'intro' },
    {
      type: 'folder', id: 'f', name: 'Folder', children: [
        { type: 'bookmark', id: '3', name: 'C', relativePath: 'a.md', anchor: 'methods' },
        { type: 'bookmark', id: '4', name: 'D', relativePath: 'a.md' },
      ],
    },
  ];

  it('flattens nested folders, keeping only the target path', () => {
    expect(collectBookmarksForPath(tree, 'a.md')).toEqual([
      { cursorOffset: 5, anchor: undefined },
      { cursorOffset: undefined, anchor: 'methods' },
      { cursorOffset: undefined, anchor: undefined },
    ]);
  });

  it('returns [] when nothing targets the path', () => {
    expect(collectBookmarksForPath(tree, 'zzz.md')).toEqual([]);
  });
});
