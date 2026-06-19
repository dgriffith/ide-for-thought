/**
 * Bookmark store — heading-rename resilience (#755). `retargetSectionAnchor`
 * repoints section bookmarks whose heading slug changed, leaving whole-file
 * bookmarks and other notes' bookmarks alone. IPC persistence is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { bookmarks: { save: vi.fn(), load: vi.fn() } },
}));

import { getBookmarksStore } from '../../../src/renderer/lib/stores/bookmarks.svelte';

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
