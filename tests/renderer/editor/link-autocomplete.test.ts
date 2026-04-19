import { describe, it, expect } from 'vitest';
import { detectCompletionPhase } from '../../../src/renderer/lib/editor/link-autocomplete';

/**
 * Helper: simulate a cursor at the end of `before`. The absolute position
 * is just `before.length` since we're treating `before` as the start of doc.
 */
function phase(before: string) {
  return detectCompletionPhase(before, before.length);
}

describe('detectCompletionPhase', () => {
  it('returns none outside a wiki link', () => {
    expect(phase('plain text here').kind).toBe('none');
  });

  it('returns none when the last [[ is already closed', () => {
    expect(phase('[[foo]] then more').kind).toBe('none');
  });

  it('returns type-or-path right after [[', () => {
    const p = phase('See [[');
    expect(p.kind).toBe('type-or-path');
    if (p.kind === 'type-or-path') {
      expect(p.prefix).toBe('');
      expect(p.innerStart).toBe('See [['.length);
    }
  });

  it('returns type-or-path when typing a prefix with no :: yet', () => {
    const p = phase('[[supp');
    expect(p.kind).toBe('type-or-path');
    if (p.kind === 'type-or-path') expect(p.prefix).toBe('supp');
  });

  it('returns path after a committed type::', () => {
    const p = phase('[[supports::note');
    expect(p.kind).toBe('path');
    if (p.kind === 'path') {
      expect(p.typePrefix).toBe('supports');
      expect(p.prefix).toBe('note');
      expect(p.innerStart).toBe('[[supports::'.length);
    }
  });

  it('returns heading after # following a plain path', () => {
    const p = phase('[[notes/foo#comp');
    expect(p.kind).toBe('heading');
    if (p.kind === 'heading') {
      expect(p.targetPath).toBe('notes/foo');
      expect(p.prefix).toBe('comp');
      expect(p.innerStart).toBe('[[notes/foo#'.length);
    }
  });

  it('returns heading after # with a typed-link prefix', () => {
    const p = phase('[[supports::notes/foo#');
    expect(p.kind).toBe('heading');
    if (p.kind === 'heading') {
      expect(p.targetPath).toBe('notes/foo');
      expect(p.prefix).toBe('');
    }
  });

  it('returns block for #^ anchor', () => {
    const p = phase('[[notes/foo#^par');
    expect(p.kind).toBe('block');
    if (p.kind === 'block') {
      expect(p.targetPath).toBe('notes/foo');
      expect(p.prefix).toBe('par');
      expect(p.innerStart).toBe('[[notes/foo#^'.length);
    }
  });

  it('stops completing once the user types |', () => {
    expect(phase('[[notes/foo|disp').kind).toBe('none');
  });

  it('returns none when inner contains a newline', () => {
    expect(phase('[[first line\nsecond').kind).toBe('none');
  });
});
