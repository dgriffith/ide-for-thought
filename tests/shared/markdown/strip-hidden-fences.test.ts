import { describe, it, expect } from 'vitest';
import { stripHiddenFences } from '../../../src/shared/markdown/fence-info';

describe('stripHiddenFences (#2509)', () => {
  it('removes a hidden fence of any language or case, keeping the prose around it', () => {
    const src = 'a\n\n```turtle-hidden\n<x> <y> <z> .\n```\n\nb\n\n~~~JSON-HIDDEN\n{}\n~~~\n\nc';
    expect(stripHiddenFences(src)).toBe('a\n\nb\n\nc');
  });

  it('touches no other spacing, inside code or out', () => {
    const src = 'p\n\n\n\nq\n\n```text\na\n\n\n\nb\n```\n';
    expect(stripHiddenFences(src)).toBe(src);
  });

  it('keeps ordinary fences, byte for byte', () => {
    const src = 'x\n\n```python\nprint(1)\n```\n\ny';
    expect(stripHiddenFences(src)).toBe(src);
  });

  it('leaves a hidden-looking fence quoted inside another code block alone', () => {
    const src = '````markdown\n```turtle-hidden\n<x> <y> <z> .\n```\n````';
    expect(stripHiddenFences(src)).toBe(src);
  });

  it('closes only on the same character, at least as long', () => {
    const src = '````turtle-hidden\n```\nstill hidden\n````\nafter';
    expect(stripHiddenFences(src)).toBe('after');
  });

  it('treats an unclosed hidden fence as running to the end, as CommonMark renders it', () => {
    expect(stripHiddenFences('keep\n```turtle-hidden\n<x> <y> <z> .')).toBe('keep');
  });

  it('does not mistake inline backticks for a fence', () => {
    const src = '```a``` inline\n```turtle-hidden\nx\n```\nend';
    expect(stripHiddenFences(src)).toBe('```a``` inline\nend');
  });
});
