import { describe, it, expect } from 'vitest';
import {
  wordTailEnd,
  completionKeymapNoEnter,
} from '../../src/renderer/lib/editor/accept-completion-eat-tail';

// The tail-eat (#206) deletes from the cursor to wordTailEnd(...). These cases
// pin the boundary that makes the behavior safe in both editors: it stops at
// the first non-word char, so brackets/punctuation around a completion survive.
describe('wordTailEnd', () => {
  it('eats a plain word tail (the SPARQL keyword case)', () => {
    // `SEL|stuff` after accepting `SELECT` becomes `SELECT|stuff`; eat `stuff`.
    expect(wordTailEnd('stuff', 0)).toBe(5);
  });

  it('stops at a closing bracket so wiki-links keep their `]]`', () => {
    // Post-accept doc line `[[Notebook]]` with cursor after `Notebook`.
    const line = '[[Notebook]]';
    const head = '[[Notebook'.length;
    expect(wordTailEnd(line, head)).toBe(head); // nothing to eat — next char is `]`
  });

  it('eats a mid-word remnant but halts at the `]`', () => {
    // `[[No|te]]`, accept `Notebook` → `[[Notebookte]]`, cursor after `Notebook`.
    const line = '[[Notebookte]]';
    const head = '[[Notebook'.length;
    expect(wordTailEnd(line, head)).toBe('[[Notebookte'.length); // eats `te`, stops at `]`
  });

  it('stops at a comma after a tag', () => {
    // `#foo, rest` with cursor after `#foo`.
    expect(wordTailEnd('#foo, rest', 4)).toBe(4);
  });

  it('stops at whitespace', () => {
    expect(wordTailEnd('SELECT distinct', 6)).toBe(6);
  });

  it('treats `_` and digits as word chars', () => {
    expect(wordTailEnd('foo_bar2)', 0)).toBe('foo_bar2'.length); // stops at `)`
  });

  it('handles an empty remnant at end of line', () => {
    expect(wordTailEnd('SELECT', 6)).toBe(6);
  });
});

describe('completionKeymapNoEnter', () => {
  it('drops the Enter binding so a custom Enter can own the key', () => {
    expect(completionKeymapNoEnter.some((b) => b.key === 'Enter')).toBe(false);
  });

  it('keeps navigation/escape bindings', () => {
    const keys = completionKeymapNoEnter.map((b) => b.key);
    expect(keys).toContain('ArrowDown');
    expect(keys).toContain('ArrowUp');
    expect(keys).toContain('Escape');
  });
});
