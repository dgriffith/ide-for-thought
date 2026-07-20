/**
 * Bookmark store — heading-rename resilience (#755). `retargetSectionAnchor`
 * repoints section bookmarks whose heading slug changed, leaving whole-file
 * bookmarks and other notes' bookmarks alone. IPC persistence is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { bookmarks: { save: vi.fn(), load: vi.fn() } },
}));

import { getBookmarksStore, collectNoteBookmarksWithFolder } from '../../../src/renderer/lib/stores/bookmarks.svelte';
import type { BookmarkNode } from '../../../src/shared/types';

const store = getBookmarksStore();

/** Remove every top-level bookmark so each test starts from a clean tree
 *  (the store is a module singleton). */
function reset() {
  for (const n of [...store.tree]) store.remove(n.id);
}

beforeEach(reset);

function bm(name: string) {
  return store.tree.find((n) => n.type === 'bookmark' && n.name === name);
}

describe('retargetSectionAnchor (#755)', () => {
  it('repoints matching section bookmarks and reports the count', () => {
    store.add('Overview', 'notes/foo.md', { anchor: 'overview' });
    store.add('foo (whole file)', 'notes/foo.md');               // no anchor
    store.add('Overview elsewhere', 'notes/bar.md', { anchor: 'overview' });

    const changed = store.retargetSectionAnchor('notes/foo.md', 'overview', 'summary');

    expect(changed).toBe(1);
    expect(bm('Overview')).toMatchObject({ relativePath: 'notes/foo.md', anchor: 'summary' });
    // Whole-file bookmark for the same note is untouched.
    expect(bm('foo (whole file)')).toMatchObject({ anchor: undefined });
    // Same slug in a different note is untouched.
    expect(bm('Overview elsewhere')).toMatchObject({ relativePath: 'notes/bar.md', anchor: 'overview' });
  });

  it('returns 0 and changes nothing when no bookmark matches', () => {
    store.add('Methods', 'notes/foo.md', { anchor: 'methods' });
    expect(store.retargetSectionAnchor('notes/foo.md', 'overview', 'summary')).toBe(0);
    expect(bm('Methods')).toMatchObject({ anchor: 'methods' });
  });

  it('updates every bookmark pointing at the same renamed heading', () => {
    store.add('one', 'notes/foo.md', { anchor: 'intro' });
    store.add('two', 'notes/foo.md', { anchor: 'intro' });
    expect(store.retargetSectionAnchor('notes/foo.md', 'intro', 'preamble')).toBe(2);
    expect(bm('one')).toMatchObject({ anchor: 'preamble' });
    expect(bm('two')).toMatchObject({ anchor: 'preamble' });
  });
});

describe('collectNoteBookmarksWithFolder (#...)', () => {
  const tree: BookmarkNode[] = [
    { type: 'bookmark', id: 'root', name: 'At root', relativePath: 'note.md' },
    {
      type: 'folder', id: 'f1', name: 'Research', children: [
        { type: 'bookmark', id: 'r1', name: 'In Research', relativePath: 'note.md' },
        {
          type: 'folder', id: 'f2', name: 'Papers', children: [
            { type: 'bookmark', id: 'p1', name: 'Deep', relativePath: 'note.md' },
            { type: 'bookmark', id: 'p2', name: 'Other note', relativePath: 'other.md' },
          ],
        },
      ],
    },
  ];

  it('pairs each matching bookmark with its containing-folder path', () => {
    const rows = collectNoteBookmarksWithFolder(tree, 'note.md');
    expect(rows.map((r) => [r.bookmark.name, r.folder])).toEqual([
      ['At root', ''],              // top-level → empty folder
      ['In Research', 'Research'],
      ['Deep', 'Research / Papers'], // nested → joined path
    ]);
  });

  it('excludes bookmarks for other notes', () => {
    const rows = collectNoteBookmarksWithFolder(tree, 'other.md');
    expect(rows.map((r) => r.bookmark.name)).toEqual(['Other note']);
    expect(rows[0]!.folder).toBe('Research / Papers');
  });

  it('honors a custom separator', () => {
    const rows = collectNoteBookmarksWithFolder(tree, 'note.md', ' › ');
    expect(rows.find((r) => r.bookmark.name === 'Deep')!.folder).toBe('Research › Papers');
  });
});
