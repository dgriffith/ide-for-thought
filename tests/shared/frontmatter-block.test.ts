/**
 * The shared frontmatter boundary and the line-ending-preserving edit
 * wrapper (#2690).
 */
import { describe, it, expect } from 'vitest';
import {
  findFrontmatter, lineEndingOf, normalizeNoteText, editNoteText, editNote,
} from '../../src/shared/frontmatter-block';
import { parseFrontmatter } from '../../src/shared/frontmatter-parse';
import { stripFrontmatter } from '../../src/shared/frontmatter-strip';
import { noteTitle } from '../../src/shared/note-title';

describe('findFrontmatter', () => {
  it('finds an LF block, ending past the closing fence\'s line break', () => {
    const c = '---\na: 1\n---\nbody';
    expect(findFrontmatter(c)).toEqual({ yaml: 'a: 1', start: 0, end: c.indexOf('body') });
  });

  it('finds a CRLF block, folding \\r\\n in the YAML so no value keeps a \\r', () => {
    const c = '---\r\na: 1\r\nb: two\r\n---\r\nbody';
    expect(findFrontmatter(c)).toEqual({ yaml: 'a: 1\nb: two', start: 0, end: c.indexOf('body') });
  });

  it('takes mixed line endings line by line', () => {
    expect(findFrontmatter('---\na: 1\r\nb: 2\n---\r\nx')?.yaml).toBe('a: 1\nb: 2');
  });

  it('allows one byte-order mark before the opening fence; the block starts after it', () => {
    const c = '\uFEFF---\r\na: 1\r\n---\r\nbody';
    expect(findFrontmatter(c)).toEqual({ yaml: 'a: 1', start: 1, end: c.indexOf('body') });
  });

  it('does not treat a lone \\r as a line break', () => {
    expect(findFrontmatter('---\ra: 1\r---\rbody')).toBeNull();
  });

  it('needs the block at the very start, and a closing fence', () => {
    expect(findFrontmatter('\n---\na: 1\n---\n')).toBeNull();
    expect(findFrontmatter('---\na: 1\n')).toBeNull();
    expect(findFrontmatter('# no frontmatter')).toBeNull();
    expect(findFrontmatter('')).toBeNull();
  });

  it('closes on a fence at end of file with no line break after it', () => {
    const c = '---\r\na: 1\r\n---';
    expect(findFrontmatter(c)).toEqual({ yaml: 'a: 1', start: 0, end: c.length });
  });
});

describe('the readers agree on a CRLF note', () => {
  const lf = '---\ntitle: Same\ntags: [x]\n---\n# Heading\n\nbody\n';
  const crlf = lf.replace(/\n/g, '\r\n');

  it('parseFrontmatter reads CRLF and BOM blocks exactly as LF', () => {
    expect(parseFrontmatter(crlf)).toEqual(parseFrontmatter(lf));
    expect(parseFrontmatter(`\uFEFF${crlf}`)).toEqual(parseFrontmatter(lf));
    expect(parseFrontmatter(crlf).title).toBe('Same');
  });

  it('stripFrontmatter removes the same block, BOM included', () => {
    expect(stripFrontmatter(crlf)).toBe('# Heading\r\n\r\nbody\r\n');
    expect(stripFrontmatter(`\uFEFF${crlf}`)).toBe('# Heading\r\n\r\nbody\r\n');
  });

  it('noteTitle (hover preview, annotated reading) reads title: from a CRLF note again', () => {
    expect(noteTitle(crlf)).toBe('Same');
  });
});

describe('line-ending helpers', () => {
  it('lineEndingOf is the first line break\'s', () => {
    expect(lineEndingOf('a\r\nb\nc')).toBe('\r\n');
    expect(lineEndingOf('a\nb\r\nc')).toBe('\n');
    expect(lineEndingOf('no break')).toBe('\n');
    expect(lineEndingOf('\nleading')).toBe('\n');
  });

  it('normalizeNoteText drops the BOM and folds \\r\\n only', () => {
    expect(normalizeNoteText('\uFEFFa\r\nb\rc\n')).toBe('a\nb\rc\n');
  });
});

describe('editNoteText', () => {
  const upper = (t: string) => t.replace('b', 'B\nnew line');

  it('passes LF text straight through', () => {
    expect(editNoteText('a\nb\nc', upper)).toBe('a\nB\nnew line\nc');
  });

  it('writes the changed text in CRLF on a CRLF note', () => {
    expect(editNoteText('a\r\nb\r\nc', upper)).toBe('a\r\nB\r\nnew line\r\nc');
  });

  it('copies untouched text byte for byte, even with mixed endings', () => {
    // First line break is CRLF, so new lines are CRLF; the lone `\n` the edit
    // didn't touch stays a lone `\n`.
    expect(editNoteText('a\r\nb\r\nc\nd', upper)).toBe('a\r\nB\r\nnew line\r\nc\nd');
  });

  it('keeps a byte-order mark, even when the edit removes everything before the body', () => {
    expect(editNoteText('\uFEFF---\r\na: 1\r\n---\r\nbody', (t) => t.slice(t.indexOf('body')))).toBe('\uFEFFbody');
  });

  it('returns the original string when the edit changes nothing', () => {
    const c = 'a\r\nb\n\uFEFF';
    expect(editNoteText(c, (t) => t)).toBe(c);
  });

  it('passes a null refusal through', () => {
    expect(editNoteText('a\r\nb', () => null)).toBeNull();
  });

  it('does not double a \\r the edit wrote itself', () => {
    expect(editNoteText('a\r\nb', (t) => `${t}\r\nc`)).toBe('a\r\nb\r\nc');
  });

  it('editNote maps only `content` and keeps the rest of the result', () => {
    expect(editNote('a\r\nb', (t) => ({ content: `${t}\nc`, n: 3 }))).toEqual({ content: 'a\r\nb\r\nc', n: 3 });
    expect(editNote('a\r\nb', () => null)).toBeNull();
  });
});
