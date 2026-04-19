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
    api.bookmarks.save($state.snapshot(tree));
  }, 500);
}

export function getBookmarksStore() {
  async function load() {
    tree = await api.bookmarks.load();
  }

  function add(name: string, relativePath: string, cursorOffset?: number, parentFolderId?: string) {
    const bookmark: Bookmark = {
      type: 'bookmark',
      id: generateId(),
      name,
      relativePath,
      cursorOffset,
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
  };
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
    if (nodes[i].id === id) {
      nodes.splice(i, 1);
      return true;
    }
    if (nodes[i].type === 'folder') {
      if (removeFromTree((nodes[i] as BookmarkFolder).children, id)) return true;
    }
  }
  return false;
}
