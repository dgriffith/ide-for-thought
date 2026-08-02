/**
 * Pure text / note-tree helpers extracted from App.svelte (#670).
 */
import { describe, it, expect } from 'vitest';
import {
  slugifyForPath,
  findAnchorOffset,
  offsetToLineCol,
  lineColToOffset,
  lineBookmarkName,
  flattenNotePaths,
  countNotes,
  describeDeleteNoun,
  describeDeleteMessage,
  formatCappedList,
} from '../../../src/renderer/lib/app/text-helpers';
import type { NoteFile } from '../../../src/shared/types';

function dir(name: string, children: NoteFile[]): NoteFile {
  return { name, relativePath: name, isDirectory: true, children };
}
function file(relativePath: string): NoteFile {
  const name = relativePath.split('/').pop()!;
  return { name, relativePath, isDirectory: false };
}

describe('slugifyForPath', () => {
  it('lowercases, dashes runs of non-alphanumerics, trims dashes', () => {
    expect(slugifyForPath('Hello, World!')).toBe('hello-world');
    expect(slugifyForPath('  Spaced  Out  ')).toBe('spaced-out');
  });
  it('caps length at 40 chars', () => {
    expect(slugifyForPath('a'.repeat(60)).length).toBe(40);
  });
  it('falls back to "overview" when nothing survives', () => {
    expect(slugifyForPath('!!!')).toBe('overview');
    expect(slugifyForPath('')).toBe('overview');
  });
});

describe('findAnchorOffset', () => {
  it('finds a heading by slug and returns its byte offset', () => {
    const text = '# Intro\n\n## My Section\n\nbody';
    const off = findAnchorOffset(text, 'my-section');
    expect(off).toBe(text.indexOf('## My Section'));
  });
  it('finds a trailing block id', () => {
    const text = 'a paragraph ^abc123\nnext';
    expect(findAnchorOffset(text, '^abc123')).toBe(0);
  });
  it('returns null when the anchor is absent', () => {
    expect(findAnchorOffset('# Intro\nbody', 'missing')).toBeNull();
  });
});

describe('offsetToLineCol', () => {
  it('maps offsets to 1-based line / 0-based col', () => {
    const text = 'abc\nde\nf';
    expect(offsetToLineCol(text, 0)).toEqual({ line: 1, col: 0 });
    expect(offsetToLineCol(text, 2)).toEqual({ line: 1, col: 2 });
    expect(offsetToLineCol(text, 4)).toEqual({ line: 2, col: 0 });
    expect(offsetToLineCol(text, 7)).toEqual({ line: 3, col: 0 });
  });
});

describe('lineColToOffset', () => {
  it('is the inverse of offsetToLineCol', () => {
    const text = 'abc\nde\nf';
    expect(lineColToOffset(text, 1, 0)).toBe(0);
    expect(lineColToOffset(text, 1, 2)).toBe(2);
    expect(lineColToOffset(text, 2, 0)).toBe(4);
    expect(lineColToOffset(text, 3, 0)).toBe(7);
    // round-trip a few offsets through both directions
    for (const off of [0, 2, 4, 5, 7]) {
      const { line, col } = offsetToLineCol(text, off);
      expect(lineColToOffset(text, line, col)).toBe(off);
    }
  });
});

describe('lineBookmarkName (#756)', () => {
  it('uses the trimmed text of the line the offset sits on', () => {
    const text = '# Title\n\n  Methods and materials  \nbody';
    const offset = text.indexOf('Methods') + 3;
    expect(lineBookmarkName(text, offset)).toBe('Methods and materials');
  });

  it('falls back to "Line N" on a blank line', () => {
    const text = 'first\n\nthird';
    const blank = text.indexOf('\n') + 1; // start of the empty line 2
    expect(lineBookmarkName(text, blank)).toBe('Line 2');
  });

  it('truncates long lines with an ellipsis', () => {
    const long = 'x'.repeat(100);
    const out = lineBookmarkName(long, 0);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(58); // 57 chars + ellipsis
  });

  it('clamps an out-of-range offset to the last line', () => {
    const text = 'one\ntwo';
    expect(lineBookmarkName(text, 9999)).toBe('two');
  });
});

describe('flattenNotePaths', () => {
  it('collects md/ttl/csv leaves recursively, skipping other files', () => {
    const tree = [
      file('a.md'),
      file('ignore.png'),
      dir('sub', [file('sub/b.ttl'), file('sub/c.csv'), file('sub/d.txt')]),
    ];
    expect(flattenNotePaths(tree)).toEqual(['a.md', 'sub/b.ttl', 'sub/c.csv']);
  });
});

describe('countNotes', () => {
  it('counts .md files recursively, not folders or other files', () => {
    const tree = [
      file('a.md'),
      file('b.csv'),
      dir('sub', [file('sub/c.md'), dir('deep', [file('sub/deep/e.md')])]),
    ];
    expect(countNotes(tree)).toBe(3);
  });
});

describe('describeDeleteNoun', () => {
  it('singular/plural by target makeup', () => {
    expect(describeDeleteNoun([{ isDirectory: false }])).toBe('note');
    expect(describeDeleteNoun([{ isDirectory: true }])).toBe('folder');
    expect(describeDeleteNoun([{ isDirectory: false }, { isDirectory: false }])).toBe('notes');
    expect(describeDeleteNoun([{ isDirectory: true }, { isDirectory: true }])).toBe('folders');
    expect(describeDeleteNoun([{ isDirectory: true }, { isDirectory: false }])).toBe('items');
  });
});

describe('describeDeleteMessage', () => {
  it('names a single target', () => {
    expect(describeDeleteMessage([{ relativePath: 'a/b.md', isDirectory: false }], 'note'))
      .toBe('Delete note "b.md"?');
  });
  it('summarizes multiple with a sample and overflow', () => {
    const targets = ['a.md', 'b.md', 'c.md', 'd.md'].map((p) => ({ relativePath: p, isDirectory: false }));
    expect(describeDeleteMessage(targets, 'notes')).toBe('Delete 4 notes (a.md, b.md, c.md, …)?');
  });
});

describe('formatCappedList', () => {
  const fails = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `n${i}.md`, error: 'x' }));

  it('renders every item when at or under the cap, no overflow line', () => {
    expect(formatCappedList(fails(2), (f) => `• ${f.path}: ${f.error}`))
      .toBe('• n0.md: x\n• n1.md: x');
  });

  it('caps at 5 and appends "…and N more"', () => {
    const out = formatCappedList(fails(7), (f) => `• ${f.path}`);
    expect(out).toBe('• n0.md\n• n1.md\n• n2.md\n• n3.md\n• n4.md\n…and 2 more');
  });

  it('honors a custom cap', () => {
    expect(formatCappedList(['a', 'b', 'c'], (s) => `• ${s}`, { cap: 2 }))
      .toBe('• a\n• b\n…and 1 more');
  });

  it('indents the overflow line with moreIndent (App export summary)', () => {
    const out = formatCappedList(['a', 'b', 'c', 'd', 'e', 'f'], (p) => `  • ${p}`, { moreIndent: '  ' });
    expect(out.endsWith('\n  …and 1 more')).toBe(true);
  });

  it('returns an empty string for no items', () => {
    expect(formatCappedList([], (s: string) => s)).toBe('');
  });
});
