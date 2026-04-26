import { describe, it, expect } from 'vitest';
import { applyBookmarkPathTransitions } from '../../src/shared/bookmark-transitions';
import type { BookmarkNode } from '../../src/shared/types';

function bm(name: string, relativePath: string, id = `bm-${name}`): BookmarkNode {
  return { type: 'bookmark', id, name, relativePath };
}

function folder(name: string, children: BookmarkNode[], id = `f-${name}`): BookmarkNode {
  return { type: 'folder', id, name, children };
}

describe('applyBookmarkPathTransitions', () => {
  it('returns false on empty transitions and leaves tree untouched', () => {
    const tree = [bm('a', 'notes/a.md')];
    expect(applyBookmarkPathTransitions(tree, [])).toBe(false);
    expect((tree[0] as { relativePath: string }).relativePath).toBe('notes/a.md');
  });

  it('rewrites an exact path match', () => {
    const tree = [bm('a', 'notes/a.md')];
    const changed = applyBookmarkPathTransitions(tree, [{ old: 'notes/a.md', new: 'archive/a.md' }]);
    expect(changed).toBe(true);
    expect((tree[0] as { relativePath: string }).relativePath).toBe('archive/a.md');
  });

  it('rewrites bookmarks inside a renamed folder (prefix match)', () => {
    const tree = [
      bm('a', 'notes/sub/x.md'),
      bm('b', 'notes/sub/y.md'),
      bm('c', 'other/z.md'),
    ];
    const changed = applyBookmarkPathTransitions(tree, [
      { old: 'notes/sub/x.md', new: 'archive/sub/x.md' },
      { old: 'notes/sub/y.md', new: 'archive/sub/y.md' },
    ]);
    expect(changed).toBe(true);
    expect((tree[0] as { relativePath: string }).relativePath).toBe('archive/sub/x.md');
    expect((tree[1] as { relativePath: string }).relativePath).toBe('archive/sub/y.md');
    expect((tree[2] as { relativePath: string }).relativePath).toBe('other/z.md'); // untouched
  });

  it('recurses into folders', () => {
    const tree = [folder('research', [bm('a', 'notes/a.md')])];
    applyBookmarkPathTransitions(tree, [{ old: 'notes/a.md', new: 'archive/a.md' }]);
    expect((tree[0] as { children: Array<{ relativePath: string }> }).children[0].relativePath).toBe('archive/a.md');
  });

  it('stops at the first matching transition (longer prefixes win)', () => {
    // If both `notes/` and `notes/sub/x.md` are in the transitions, the
    // longer (more specific) entry should win.
    const tree = [bm('a', 'notes/sub/x.md')];
    applyBookmarkPathTransitions(tree, [
      { old: 'notes', new: 'archive' },
      { old: 'notes/sub/x.md', new: 'archive/sub/new-x.md' },
    ]);
    expect((tree[0] as { relativePath: string }).relativePath).toBe('archive/sub/new-x.md');
  });

  it('returns false when no bookmark matches any transition', () => {
    const tree = [bm('a', 'notes/a.md')];
    const changed = applyBookmarkPathTransitions(tree, [{ old: 'other/b.md', new: 'archive/b.md' }]);
    expect(changed).toBe(false);
  });
});
