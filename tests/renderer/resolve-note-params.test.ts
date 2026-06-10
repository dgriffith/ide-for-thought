import { describe, it, expect } from 'vitest';
import { resolveNoteParams, flattenNoteFiles } from '../../src/renderer/lib/tools/resolve-note-params';
import type { ToolParameter } from '../../src/shared/tools/types';

const noteParam: ToolParameter = { id: 'otherNote', label: 'Compare against', type: 'note' };
const textParam: ToolParameter = { id: 'angle', label: 'Angle', type: 'text' };

describe('resolveNoteParams', () => {
  it('reads a picked note into companion .content / .title vars', async () => {
    const reader = async (p: string) => (p === 'ideas/Foundations.md' ? '# Foundations\n\nbody text' : '');
    const out = await resolveNoteParams(
      [noteParam, textParam],
      { otherNote: 'ideas/Foundations.md', angle: 'epistemic' },
      reader,
    );
    expect(out.otherNote).toBe('ideas/Foundations.md'); // path preserved
    expect(out['otherNote.title']).toBe('Foundations'); // basename, .md stripped
    expect(out['otherNote.content']).toBe('# Foundations\n\nbody text');
    expect(out.angle).toBe('epistemic'); // non-note params untouched
  });

  it('leaves path + title but omits content when the note is unreadable', async () => {
    const reader = async () => { throw new Error('ENOENT'); };
    const out = await resolveNoteParams([noteParam], { otherNote: 'gone.md' }, reader);
    expect(out.otherNote).toBe('gone.md');
    expect(out['otherNote.title']).toBe('gone');
    expect(out['otherNote.content']).toBeUndefined();
  });

  it('ignores a note param with no pick and never calls the reader', async () => {
    let called = false;
    const reader = async () => { called = true; return ''; };
    const out = await resolveNoteParams([noteParam], { otherNote: '' }, reader);
    expect(out['otherNote.content']).toBeUndefined();
    expect(called).toBe(false);
  });
});

describe('flattenNoteFiles', () => {
  it('flattens the tree to markdown files only', () => {
    const tree = [
      { name: 'A.md', relativePath: 'A.md', isDirectory: false },
      { name: 'img.png', relativePath: 'img.png', isDirectory: false },
      {
        name: 'sub', relativePath: 'sub', isDirectory: true, children: [
          { name: 'B.md', relativePath: 'sub/B.md', isDirectory: false },
          { name: 'notes', relativePath: 'sub/notes', isDirectory: true, children: [
            { name: 'C.md', relativePath: 'sub/notes/C.md', isDirectory: false },
          ] },
        ],
      },
    ];
    expect(flattenNoteFiles(tree).map((f) => f.relativePath)).toEqual(['A.md', 'sub/B.md', 'sub/notes/C.md']);
  });
});
