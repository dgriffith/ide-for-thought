import { describe, it, expect } from 'vitest';
import { toggleTaskOnLine } from '../../../src/renderer/lib/editor/task-toggle';

describe('toggleTaskOnLine (#127)', () => {
  it('flips `[ ]` to `[x]` on the matching line', () => {
    const src = '- [ ] todo\n- [ ] another\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [x] todo\n- [ ] another\n');
  });

  it('flips `[x]` back to `[ ]`', () => {
    const src = '- [x] done\n- [ ] pending\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [ ] done\n- [ ] pending\n');
  });

  it('treats uppercase `[X]` as done', () => {
    const src = '- [X] done\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [ ] done\n');
  });

  it('preserves leading indentation (nested items)', () => {
    const src = '- [ ] outer\n  - [ ] inner\n';
    expect(toggleTaskOnLine(src, 1)).toBe('- [ ] outer\n  - [x] inner\n');
  });

  it('works with asterisk and plus markers', () => {
    expect(toggleTaskOnLine('* [ ] foo\n', 0)).toBe('* [x] foo\n');
    expect(toggleTaskOnLine('+ [ ] foo\n', 0)).toBe('+ [x] foo\n');
  });

  it('works with ordered list markers', () => {
    expect(toggleTaskOnLine('1. [ ] numbered\n', 0)).toBe('1. [x] numbered\n');
  });

  it('leaves lines that are not task items unchanged (by reference)', () => {
    const src = 'plain paragraph\n- [ ] item\n';
    expect(toggleTaskOnLine(src, 0)).toBe(src);
  });

  it('does not match `[ ]` without a list marker', () => {
    const src = 'just some [ ] text\n';
    expect(toggleTaskOnLine(src, 0)).toBe(src);
  });

  it('does not match when no whitespace follows the `]`', () => {
    const src = '- [ ]foo\n';
    expect(toggleTaskOnLine(src, 0)).toBe(src);
  });

  it('handles a task item with empty body', () => {
    expect(toggleTaskOnLine('- [ ]\n', 0)).toBe('- [x]\n');
  });

  it('returns content unchanged for out-of-range line index', () => {
    const src = '- [ ] only line\n';
    expect(toggleTaskOnLine(src, 99)).toBe(src);
    expect(toggleTaskOnLine(src, -1)).toBe(src);
  });

  it('preserves CRLF line endings when line content has \\r', () => {
    const src = '- [ ] foo\r\n- [ ] bar\r\n';
    const out = toggleTaskOnLine(src, 0);
    expect(out).toBe('- [x] foo\r\n- [ ] bar\r\n');
  });
});
