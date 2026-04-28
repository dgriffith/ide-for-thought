/**
 * Pure helpers for sidebar multi-selection — `flattenVisible` (used by
 * shift-click range and ⌘A) and `expandSelectionToNoteFiles` (used by
 * the Format command to resolve a sidebar selection to the set of
 * .md files to act on).
 */

import { describe, it, expect } from 'vitest';
import { flattenVisible, expandSelectionToNoteFiles, resolveSelectionTargets, pathExistsInTree } from '../../src/renderer/lib/sidebar-tree-utils';
import type { NoteFile } from '../../src/shared/types';

const tree: NoteFile[] = [
  {
    name: 'notes',
    relativePath: 'notes',
    isDirectory: true,
    children: [
      { name: 'a.md', relativePath: 'notes/a.md', isDirectory: false },
      {
        name: 'sub',
        relativePath: 'notes/sub',
        isDirectory: true,
        children: [
          { name: 'b.md', relativePath: 'notes/sub/b.md', isDirectory: false },
          { name: 'c.md', relativePath: 'notes/sub/c.md', isDirectory: false },
        ],
      },
      { name: 'd.md', relativePath: 'notes/d.md', isDirectory: false },
    ],
  },
  { name: 'top.md', relativePath: 'top.md', isDirectory: false },
];

describe('flattenVisible', () => {
  it('returns only top-level rows when nothing is expanded', () => {
    expect(flattenVisible(tree, {})).toEqual(['notes', 'top.md']);
  });

  it('returns immediate children when one directory is expanded', () => {
    expect(flattenVisible(tree, { notes: true })).toEqual([
      'notes', 'notes/a.md', 'notes/sub', 'notes/d.md', 'top.md',
    ]);
  });

  it('descends through nested expanded directories', () => {
    expect(flattenVisible(tree, { notes: true, 'notes/sub': true })).toEqual([
      'notes', 'notes/a.md', 'notes/sub', 'notes/sub/b.md', 'notes/sub/c.md', 'notes/d.md', 'top.md',
    ]);
  });

  it('does not descend when an outer directory is collapsed even if its child is marked expanded', () => {
    // Collapsing the parent hides everything below it; leaf-expanded state
    // is harmless and persists for when the parent is reopened.
    expect(flattenVisible(tree, { 'notes/sub': true })).toEqual(['notes', 'top.md']);
  });
});

describe('expandSelectionToNoteFiles', () => {
  it('passes through a selection of explicit .md files', () => {
    const r = expandSelectionToNoteFiles(new Set(['notes/a.md', 'top.md']), tree);
    expect(r.sort()).toEqual(['notes/a.md', 'top.md'].sort());
  });

  it('expands a directory selection to every .md descendant', () => {
    const r = expandSelectionToNoteFiles(new Set(['notes/sub']), tree);
    expect(r.sort()).toEqual(['notes/sub/b.md', 'notes/sub/c.md']);
  });

  it('walks the whole subtree when a top-level directory is selected', () => {
    const r = expandSelectionToNoteFiles(new Set(['notes']), tree);
    expect(r.sort()).toEqual([
      'notes/a.md', 'notes/d.md', 'notes/sub/b.md', 'notes/sub/c.md',
    ]);
  });

  it('deduplicates when a file is also under a selected directory', () => {
    const r = expandSelectionToNoteFiles(new Set(['notes', 'notes/a.md']), tree);
    expect(r.length).toBe(new Set(r).size);
    expect(r).toContain('notes/a.md');
  });

  it('drops paths that do not exist in the tree', () => {
    const r = expandSelectionToNoteFiles(new Set(['nonexistent', 'notes/a.md']), tree);
    expect(r).toEqual(['notes/a.md']);
  });

  it('returns empty when the selection has no .md leaves (e.g. selected an empty folder)', () => {
    const emptyTree: NoteFile[] = [
      { name: 'empty', relativePath: 'empty', isDirectory: true, children: [] },
    ];
    expect(expandSelectionToNoteFiles(new Set(['empty']), emptyTree)).toEqual([]);
  });
});

describe('resolveSelectionTargets', () => {
  it('keeps directories as directories (does NOT expand to descendants)', () => {
    const r = resolveSelectionTargets(new Set(['notes/sub']), tree);
    expect(r).toEqual([{ relativePath: 'notes/sub', isDirectory: true }]);
  });

  it('keeps a mixed file + folder selection as two separate targets', () => {
    const r = resolveSelectionTargets(new Set(['notes/sub', 'top.md']), tree);
    expect(r.sort((a, b) => a.relativePath.localeCompare(b.relativePath))).toEqual([
      { relativePath: 'notes/sub', isDirectory: true },
      { relativePath: 'top.md', isDirectory: false },
    ]);
  });

  it('drops a child path when its ancestor directory is also selected', () => {
    // Deleting `notes/sub` already removes `notes/sub/b.md`; surfacing both
    // would either double-fail or paper over a real error after the parent
    // disappears.
    const r = resolveSelectionTargets(new Set(['notes/sub', 'notes/sub/b.md']), tree);
    expect(r).toEqual([{ relativePath: 'notes/sub', isDirectory: true }]);
  });

  it('drops nested descendants when an outer directory is selected', () => {
    const r = resolveSelectionTargets(new Set(['notes', 'notes/sub/b.md', 'notes/a.md']), tree);
    expect(r).toEqual([{ relativePath: 'notes', isDirectory: true }]);
  });

  it('keeps siblings whose names share a prefix with a selected dir', () => {
    // `notesArchive` must NOT be treated as a child of `notes`. The ancestor
    // check uses `path.startsWith(dir + '/')` for exactly this reason.
    const sharedPrefixTree: NoteFile[] = [
      { name: 'notes', relativePath: 'notes', isDirectory: true, children: [] },
      { name: 'notesArchive.md', relativePath: 'notesArchive.md', isDirectory: false },
    ];
    const r = resolveSelectionTargets(new Set(['notes', 'notesArchive.md']), sharedPrefixTree);
    expect(r.sort((a, b) => a.relativePath.localeCompare(b.relativePath))).toEqual([
      { relativePath: 'notes', isDirectory: true },
      { relativePath: 'notesArchive.md', isDirectory: false },
    ]);
  });

  it('drops paths missing from the tree (stale selection)', () => {
    const r = resolveSelectionTargets(new Set(['gone.md', 'top.md']), tree);
    expect(r).toEqual([{ relativePath: 'top.md', isDirectory: false }]);
  });

  it('returns empty for an empty selection', () => {
    expect(resolveSelectionTargets(new Set(), tree)).toEqual([]);
  });
});

describe('pathExistsInTree', () => {
  it('finds a file at the root', () => {
    expect(pathExistsInTree('top.md', tree)).toBe(true);
  });
  it('finds a deeply nested file', () => {
    expect(pathExistsInTree('notes/sub/c.md', tree)).toBe(true);
  });
  it('finds a directory', () => {
    expect(pathExistsInTree('notes/sub', tree)).toBe(true);
  });
  it('returns false for a missing path', () => {
    expect(pathExistsInTree('notes/missing.md', tree)).toBe(false);
  });
  it('returns false for a path that shares a prefix with a real one', () => {
    // `notes/sub` exists but `notes/su` must NOT match.
    expect(pathExistsInTree('notes/su', tree)).toBe(false);
  });
});
