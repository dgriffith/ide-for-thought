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

describe('toggleTaskOnLine — downward cascade', () => {
  it('checking a parent checks every nested sub-task', () => {
    const src = '- [ ] parent\n  - [ ] a\n  - [ ] b\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [x] parent\n  - [x] a\n  - [x] b\n');
  });

  it('unchecking a parent unchecks its sub-tasks (symmetric)', () => {
    const src = '- [x] parent\n  - [x] a\n  - [x] b\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [ ] parent\n  - [ ] a\n  - [ ] b\n');
  });

  it('cascades through multiple depths', () => {
    const src = '- [ ] p\n  - [ ] c1\n    - [ ] g1\n  - [ ] c2\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [x] p\n  - [x] c1\n    - [x] g1\n  - [x] c2\n');
  });

  it('stops at a sibling / ancestor — later top-level tasks are untouched', () => {
    const src = '- [ ] p\n  - [ ] child\n- [ ] sibling\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [x] p\n  - [x] child\n- [ ] sibling\n');
  });

  it('toggling a leaf does not touch its parent or siblings', () => {
    const src = '- [ ] p\n  - [ ] a\n  - [ ] b\n';
    // Toggle `a` (line 1): only `a` flips.
    expect(toggleTaskOnLine(src, 1)).toBe('- [ ] p\n  - [x] a\n  - [ ] b\n');
  });

  it('blank lines within the subtree do not end the cascade', () => {
    const src = '- [ ] p\n  - [ ] a\n\n  - [ ] b\n- [ ] after\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [x] p\n  - [x] a\n\n  - [x] b\n- [ ] after\n');
  });

  it('leaves non-task lines inside the subtree untouched but keeps cascading past them', () => {
    const src = '- [ ] p\n  - [ ] a\n  a note about a\n    - [ ] deep\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [x] p\n  - [x] a\n  a note about a\n    - [x] deep\n');
  });

  it('cascades under tab-indented children too', () => {
    const src = '- [ ] p\n\t- [ ] a\n';
    expect(toggleTaskOnLine(src, 0)).toBe('- [x] p\n\t- [x] a\n');
  });

  it('is idempotent when children already share the new state', () => {
    const src = '- [ ] p\n  - [x] a\n  - [ ] b\n';
    // Parent → checked: `a` stays checked, `b` becomes checked.
    expect(toggleTaskOnLine(src, 0)).toBe('- [x] p\n  - [x] a\n  - [x] b\n');
  });
});
