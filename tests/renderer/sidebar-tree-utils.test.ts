/**
 * Pure helpers for sidebar multi-selection — `flattenVisible` (used by
 * shift-click range and ⌘A) and `expandSelectionToNoteFiles` (used by
 * the Format command to resolve a sidebar selection to the set of
 * .md files to act on).
 */

import { describe, it, expect } from 'vitest';
import { flattenVisible, expandSelectionToNoteFiles } from '../../src/renderer/lib/sidebar-tree-utils';
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
