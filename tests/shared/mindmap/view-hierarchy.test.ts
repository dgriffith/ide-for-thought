/**
 * The Mindmap layout's tree (#2966): the view as the root, the notes with no
 * parent in the view as its branches, each note under its parent in the
 * view's order, and a loop of parents drawn rather than lost.
 */
import { describe, it, expect } from 'vitest';
import { viewHierarchy, VIEW_ROOT_ID } from '../../../src/shared/mindmap/view-hierarchy';
import type { MindmapNoteTree } from '../../../src/shared/mindmap/note-hierarchy';

const n = (path: string, parent: string | null = null) => ({ path, title: path.replace('.md', ''), parent });
const shape = (t: MindmapNoteTree, d = 0): string[] => [`${'  '.repeat(d)}${t.label}${t.mark ? ` [${t.mark}]` : ''}`, ...t.children.flatMap((c) => shape(c, d + 1))];

describe('viewHierarchy (#2966)', () => {
  it('roots are the notes with no parent in the view; each note under its parent, in the view\'s order', () => {
    const t = viewHierarchy([n('Launch.md'), n('Market.md', 'Launch.md'), n('Build.md', 'Launch.md'), n('Code.md', 'Build.md'), n('Side.md', 'Elsewhere.md')], 'Tasks');
    expect(t.id).toBe(VIEW_ROOT_ID);
    expect(shape(t)).toEqual(['Tasks', '  Launch', '    Market', '    Build', '      Code', '  Side']);
  });

  it('a loop of parents is drawn at the top, marked, not lost; a note its own parent is a root', () => {
    const t = viewHierarchy([n('A.md', 'B.md'), n('B.md', 'A.md'), n('Self.md', 'Self.md')], 'Tasks');
    expect(shape(t)).toEqual(['Tasks', '  Self', '  A [cycle]', '    B']);
  });
});
