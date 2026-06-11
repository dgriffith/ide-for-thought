import { describe, it, expect } from 'vitest';
import {
  findFrontmatterFoldRange,
  docFromText,
  type LineDoc,
} from '../../src/renderer/lib/editor/frontmatter';

// findFrontmatterFoldRange replaces a scan that was copied in two places in
// Editor.svelte. docFromText mirrors CodeMirror's offset semantics so these
// offsets are exactly what the real `view.state.doc` would yield.

describe('docFromText (CM offset parity)', () => {
  it('computes from/to offsets with newline separators', () => {
    const doc = docFromText('a\nbb\nccc');
    expect(doc.lines).toBe(3);
    expect(doc.line(1)).toEqual({ text: 'a', from: 0, to: 1 });
    expect(doc.line(2)).toEqual({ text: 'bb', from: 2, to: 4 });
    expect(doc.line(3)).toEqual({ text: 'ccc', from: 5, to: 8 });
  });
});

describe('findFrontmatterFoldRange', () => {
  it('spans from the end of the opening fence to the end of the closing fence', () => {
    // ---\nkey: v\n---\nbody
    //  opening `---` is line 1 (from 0, to 3); closing `---` is line 3.
    const text = '---\nkey: v\n---\nbody';
    const range = findFrontmatterFoldRange(docFromText(text));
    // from = end of line 1 (3); to = end of closing line 3.
    // line 3 starts at 4 + 7 = 11, length 3 → to 14.
    expect(range).toEqual({ from: 3, to: 14 });
    // Sanity: both fence lines stay visible — the fold begins after the first
    // `---` and ends at the second `---`'s line end.
    expect(text.slice(range!.from, range!.to)).toBe('\nkey: v\n---');
  });

  it('returns null when the doc does not open with a fence', () => {
    expect(findFrontmatterFoldRange(docFromText('# Title\n\nbody'))).toBeNull();
  });

  it('returns null when there is no closing fence', () => {
    expect(findFrontmatterFoldRange(docFromText('---\nkey: v\nno close'))).toBeNull();
  });

  it('returns null for a doc shorter than two lines', () => {
    expect(findFrontmatterFoldRange(docFromText('---'))).toBeNull();
    expect(findFrontmatterFoldRange(docFromText(''))).toBeNull();
  });

  it('tolerates surrounding whitespace on the fence lines (trim)', () => {
    const range = findFrontmatterFoldRange(docFromText('---  \nk: v\n  ---\nx'));
    expect(range).not.toBeNull();
  });

  it('accepts a CM-shaped doc directly (structural typing)', () => {
    // Proves the real `view.state.doc` (lines + 1-indexed line()) is accepted.
    const cmLike: LineDoc = {
      lines: 3,
      line: (n) => [
        { text: '---', from: 0, to: 3 },
        { text: 'a: 1', from: 4, to: 8 },
        { text: '---', from: 9, to: 12 },
      ][n - 1],
    };
    expect(findFrontmatterFoldRange(cmLike)).toEqual({ from: 3, to: 12 });
  });
});
