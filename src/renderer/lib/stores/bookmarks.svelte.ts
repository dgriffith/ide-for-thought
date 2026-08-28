import { api } from '../ipc/client';
import type { BookmarkNode, Bookmark, BookmarkFolder } from '../../../shared/types';
import { applyBookmarkPathTransitions } from '../../../shared/bookmark-transitions';

let tree = $state<BookmarkNode[]>([]);
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function generateId(): string {
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void api.bookmarks.save($state.snapshot(tree));
  }, 500);
}

/** Test-only: cancel a pending debounced persist without saving, so a real
 *  500ms timer armed by one test can't fire mid-run of a later one (#1944). */
export function _clearPendingPersistForTests(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}

export function getBookmarksStore() {
  async function load() {
    tree = await api.bookmarks.load();
  }

  function add(
    name: string,
    relativePath: string,
    opts: { cursorOffset?: number; anchor?: string; parentFolderId?: string } = {},
  ) {
    const { cursorOffset, anchor, parentFolderId } = opts;
    const bookmark: Bookmark = {
      type: 'bookmark',
      id: generateId(),
      name,
      relativePath,
      cursorOffset,
      anchor,
    };
    if (parentFolderId) {
      const folder = findFolder(tree, parentFolderId);
      if (folder) {
        folder.children.push(bookmark);
      } else {
        tree.push(bookmark);
      }
    } else {
      tree.push(bookmark);
    }
    schedulePersist();
  }

  function addFolder(name: string, parentFolderId?: string) {
    const folder: BookmarkFolder = {
      type: 'folder',
      id: generateId(),
      name,
      children: [],
    };
    if (parentFolderId) {
      const parent = findFolder(tree, parentFolderId);
      if (parent) {
        parent.children.push(folder);
      } else {
        tree.push(folder);
      }
    } else {
      tree.push(folder);
    }
    schedulePersist();
  }

  function rename(id: string, newName: string) {
    const node = findNode(tree, id);
    if (node) {
      node.name = newName;
      schedulePersist();
    }
  }

  function remove(id: string) {
    removeFromTree(tree, id);
    schedulePersist();
  }

  /** Fold note rename/move path transitions into every matching bookmark. */
  function applyRenameTransitions(transitions: Array<{ old: string; new: string }>) {
    if (applyBookmarkPathTransitions(tree, transitions)) {
      schedulePersist();
    }
  }

  /**
   * Heading-rename resilience (#755): when a heading in `relativePath` is
   * renamed (`oldAnchor` slug → `newAnchor`), repoint every section bookmark
   * that targeted the old slug so it keeps resolving. Returns the number of
   * bookmarks updated. Pure-local metadata edit — no file mutation.
   */
  function retargetSectionAnchor(relativePath: string, oldAnchor: string, newAnchor: string): number {
    let changed = 0;
    const walk = (nodes: BookmarkNode[]) => {
      for (const n of nodes) {
        if (n.type === 'folder') walk(n.children);
        else if (n.relativePath === relativePath && n.anchor === oldAnchor) {
          n.anchor = newAnchor;
          changed++;
        }
      }
    };
    walk(tree);
    if (changed > 0) schedulePersist();
    return changed;
  }

  function move(id: string, targetFolderId: string | null) {
    const node = findNode(tree, id);
    if (!node) return;
    removeFromTree(tree, id);
    if (targetFolderId) {
      const folder = findFolder(tree, targetFolderId);
      if (folder) {
        folder.children.push(node);
      } else {
        tree.push(node);
      }
    } else {
      tree.push(node);
    }
    schedulePersist();
  }

  return {
    get tree() { return tree; },
    load,
    add,
    addFolder,
    rename,
    remove,
    move,
    applyRenameTransitions,
    retargetSectionAnchor,
  };
}

/**
 * Flatten the bookmark tree to the position-bearing bookmarks targeting
 * `relativePath` — what the editor's gutter-flag extension needs (#756).
 * Pure (takes the tree explicitly) so callers in a `$derived` track it and
 * it stays unit-testable.
 */
export function collectBookmarksForPath(
  nodes: readonly BookmarkNode[],
  relativePath: string,
): Array<{ cursorOffset?: number | undefined; anchor?: string | undefined }> {
  const out: Array<{ cursorOffset?: number | undefined; anchor?: string | undefined }> = [];
  const walk = (ns: readonly BookmarkNode[]) => {
    for (const n of ns) {
      if (n.type === 'folder') walk(n.children);
      else if (n.relativePath === relativePath) {
        out.push({ cursorOffset: n.cursorOffset, anchor: n.anchor });
      }
    }
  };
  walk(nodes);
  return out;
}

// ── Tree helpers ─────────────────────────────────────────────────────────

function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === 'folder') {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findFolder(nodes: BookmarkNode[], id: string): BookmarkFolder | null {
  const node = findNode(nodes, id);
  return node?.type === 'folder' ? node : null;
}

function removeFromTree(nodes: BookmarkNode[], id: string): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.id === id) {
      nodes.splice(i, 1);
      return true;
    }
    if (node.type === 'folder') {
      if (removeFromTree(node.children, id)) return true;
    }
  }
  return false;
}
