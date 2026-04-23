import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { searchInNotes, replaceInNotes } from '../../src/main/notebase/search-in-notes';

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-search-test-'));
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('searchInNotes', () => {
  let root: string;

  beforeEach(() => { root = mkTemp(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('finds substring matches across multiple files with line + column info', async () => {
    write(root, 'a.md', 'hello world\nanother line\n');
    write(root, 'b.md', 'hello again\nno match here\n');
    const out = await searchInNotes(root, { pattern: 'hello', caseSensitive: false, regex: false });
    expect(out.length).toBe(2);
    expect(out[0].relativePath).toBe('a.md');
    expect(out[0].matches[0]).toEqual({ line: 1, startCol: 0, endCol: 5, lineText: 'hello world' });
    expect(out[1].relativePath).toBe('b.md');
    expect(out[1].matches[0].line).toBe(1);
  });

  it('treats plain patterns as literal (special chars are escaped)', async () => {
    write(root, 'a.md', 'cost: $5.00 today\n');
    const out = await searchInNotes(root, { pattern: '$5.00', caseSensitive: true, regex: false });
    expect(out.length).toBe(1);
    expect(out[0].matches[0].lineText).toBe('cost: $5.00 today');
  });

  it('respects case-sensitive flag', async () => {
    write(root, 'a.md', 'Hello world\nhello again\n');
    const insens = await searchInNotes(root, { pattern: 'hello', caseSensitive: false, regex: false });
    expect(insens[0].matches.length).toBe(2);
    const sens = await searchInNotes(root, { pattern: 'hello', caseSensitive: true, regex: false });
    expect(sens[0].matches.length).toBe(1);
    expect(sens[0].matches[0].line).toBe(2);
  });

  it('supports regex mode', async () => {
    write(root, 'a.md', 'foo-bar\nfoo_baz\n');
    const out = await searchInNotes(root, { pattern: 'foo.bar', caseSensitive: false, regex: true });
    expect(out[0].matches.length).toBe(1);
    expect(out[0].matches[0].line).toBe(1);
  });

  it('returns empty for an invalid regex instead of throwing', async () => {
    write(root, 'a.md', 'content\n');
    const out = await searchInNotes(root, { pattern: '[unclosed', caseSensitive: false, regex: true });
    expect(out).toEqual([]);
  });

  it('ignores .git, node_modules, .minerva, .obsidian, and dotfiles', async () => {
    write(root, 'notes/a.md', 'hello\n');
    write(root, '.git/b.md', 'hello\n');
    write(root, 'node_modules/c.md', 'hello\n');
    write(root, '.minerva/d.md', 'hello\n');
    write(root, '.obsidian/e.md', 'hello\n');
    write(root, '.hidden.md', 'hello\n');
    const out = await searchInNotes(root, { pattern: 'hello', caseSensitive: false, regex: false });
    expect(out.map((r) => r.relativePath)).toEqual(['notes/a.md']);
  });

  it('scans all indexable extensions (.md, .ttl, .csv), skips others', async () => {
    write(root, 'a.md', 'hit\n');
    write(root, 'b.ttl', 'hit\n');
    write(root, 'c.csv', 'hit\n');
    write(root, 'd.txt', 'hit\n');
    const out = await searchInNotes(root, { pattern: 'hit', caseSensitive: false, regex: false });
    expect(out.map((r) => r.relativePath).sort()).toEqual(['a.md', 'b.ttl', 'c.csv'].sort());
  });

  it('reports multiple matches on the same line with distinct columns', async () => {
    write(root, 'a.md', 'foo bar foo baz foo\n');
    const out = await searchInNotes(root, { pattern: 'foo', caseSensitive: false, regex: false });
    const m = out[0].matches;
    expect(m.length).toBe(3);
    expect(m.map((x) => x.startCol)).toEqual([0, 8, 16]);
  });

  it('does not infinite-loop on zero-width regex like ^', async () => {
    write(root, 'a.md', 'one\ntwo\nthree\n');
    const out = await searchInNotes(root, { pattern: '^', caseSensitive: false, regex: true });
    // Line count matches; infinite loop would hang the test.
    expect(out[0].matches.length).toBeGreaterThan(0);
  });
});

describe('replaceInNotes', () => {
  let root: string;

  beforeEach(() => { root = mkTemp(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('replaces only the selected matches on a line with multiple hits', async () => {
    write(root, 'a.md', 'foo bar foo baz foo\n');
    const { changedPaths, replacedCount } = await replaceInNotes(root, {
      pattern: 'foo',
      caseSensitive: false,
      regex: false,
      replacement: 'X',
      // Only select the first and third foo (cols 0 and 16) — leave middle.
      selections: [
        { relativePath: 'a.md', line: 1, startCol: 0, endCol: 3 },
        { relativePath: 'a.md', line: 1, startCol: 16, endCol: 19 },
      ],
    });
    expect(changedPaths).toEqual(['a.md']);
    expect(replacedCount).toBe(2);
    const after = await fsp.readFile(path.join(root, 'a.md'), 'utf-8');
    expect(after).toBe('X bar foo baz X\n');
  });

  it('replaces every selected match across multiple files', async () => {
    write(root, 'a.md', 'alpha beta\n');
    write(root, 'b.md', 'beta gamma\n');
    const { changedPaths } = await replaceInNotes(root, {
      pattern: 'beta',
      caseSensitive: false,
      regex: false,
      replacement: 'BETA',
      selections: [
        { relativePath: 'a.md', line: 1, startCol: 6, endCol: 10 },
        { relativePath: 'b.md', line: 1, startCol: 0, endCol: 4 },
      ],
    });
    expect(changedPaths.sort()).toEqual(['a.md', 'b.md']);
    expect(await fsp.readFile(path.join(root, 'a.md'), 'utf-8')).toBe('alpha BETA\n');
    expect(await fsp.readFile(path.join(root, 'b.md'), 'utf-8')).toBe('BETA gamma\n');
  });

  it('does nothing when no selections are passed', async () => {
    write(root, 'a.md', 'foo\n');
    const out = await replaceInNotes(root, {
      pattern: 'foo',
      caseSensitive: false,
      regex: false,
      replacement: 'bar',
      selections: [],
    });
    expect(out.changedPaths).toEqual([]);
    expect(await fsp.readFile(path.join(root, 'a.md'), 'utf-8')).toBe('foo\n');
  });

  it('leaves unselected files alone even when they contain matches', async () => {
    write(root, 'a.md', 'foo\n');
    write(root, 'b.md', 'foo\n');
    await replaceInNotes(root, {
      pattern: 'foo',
      caseSensitive: false,
      regex: false,
      replacement: 'bar',
      selections: [{ relativePath: 'a.md', line: 1, startCol: 0, endCol: 3 }],
    });
    expect(await fsp.readFile(path.join(root, 'a.md'), 'utf-8')).toBe('bar\n');
    expect(await fsp.readFile(path.join(root, 'b.md'), 'utf-8')).toBe('foo\n');
  });
});
