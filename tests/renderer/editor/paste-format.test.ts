/**
 * Format-on-paste pipeline (#160). The always-on context tidies are pure
 * `(text, ctx) → text`; `formatPaste` composes them with the paste-safe
 * formatter rules. The Editor integration (protected-region guard, CM
 * dispatch) is covered by manual testing; here we pin the pure logic.
 */

import { describe, it, expect } from 'vitest';
import {
  blockTrim,
  dedupeMarker,
  stripFootnoteRefs,
  addBlockquoteIndent,
  formatPaste,
  type PasteContext,
} from '../../../src/renderer/lib/editor/paste-format';
import { DEFAULT_FORMAT_SETTINGS } from '../../../src/shared/formatter/engine';

const ctx = (over: Partial<PasteContext> = {}): PasteContext => ({
  lineBeforeCursor: '',
  inBlockquote: false,
  ...over,
});

describe('blockTrim', () => {
  it('strips outer blank lines', () => {
    expect(blockTrim('\n\nfoo\nbar\n\n')).toBe('foo\nbar');
    expect(blockTrim('  \n foo\n')).toBe(' foo');
  });

  it('leaves a single-line paste untouched (preserves join-spaces)', () => {
    expect(blockTrim(' bar')).toBe(' bar');
    expect(blockTrim('  hi  ')).toBe('  hi  ');
  });

  it('preserves first-line indentation of a multi-line paste', () => {
    expect(blockTrim('\n  - nested\n  - items')).toBe('  - nested\n  - items');
  });
});

describe('dedupeMarker', () => {
  it('drops a leading "- " when the cursor is on an empty list item', () => {
    expect(dedupeMarker('- foo\n- bar', ctx({ lineBeforeCursor: '- ' }))).toBe('foo\n- bar');
  });

  it('drops a leading checklist marker when the cursor is on an empty checklist item', () => {
    expect(dedupeMarker('- [ ] task', ctx({ lineBeforeCursor: '- [ ] ' }))).toBe('task');
  });

  it('drops an ordered marker when the cursor is on an empty ordered item', () => {
    expect(dedupeMarker('3. third', ctx({ lineBeforeCursor: '1. ' }))).toBe('third');
  });

  it('leaves text alone when the cursor line is not an empty marker', () => {
    expect(dedupeMarker('- foo', ctx({ lineBeforeCursor: 'some text ' }))).toBe('- foo');
  });

  it('leaves text alone when the pasted line has no marker', () => {
    expect(dedupeMarker('plain', ctx({ lineBeforeCursor: '- ' }))).toBe('plain');
  });
});

describe('stripFootnoteRefs', () => {
  it('removes inline footnote references', () => {
    expect(stripFootnoteRefs('A claim[^1] and another[^note].')).toBe('A claim and another.');
  });

  it('keeps footnote definitions', () => {
    expect(stripFootnoteRefs('[^1]: the definition')).toBe('[^1]: the definition');
  });
});

describe('addBlockquoteIndent', () => {
  it('prefixes continuation lines with the quote marker', () => {
    expect(addBlockquoteIndent('line one\nline two', ctx({ lineBeforeCursor: '> ' })))
      .toBe('line one\n> line two');
  });

  it('preserves a nested quote prefix', () => {
    expect(addBlockquoteIndent('a\nb', ctx({ lineBeforeCursor: '>> ' })))
      .toBe('a\n>> b');
  });

  it('does not double-prefix lines that already start a quote', () => {
    expect(addBlockquoteIndent('a\n> b', ctx({ lineBeforeCursor: '> ' })))
      .toBe('a\n> b');
  });

  it('leaves single-line pastes unchanged', () => {
    expect(addBlockquoteIndent('just one', ctx({ lineBeforeCursor: '> ' }))).toBe('just one');
  });
});

describe('formatPaste composition', () => {
  it('trims, then strips footnotes and indents inside a blockquote', () => {
    const out = formatPaste('\nfirst\nsecond[^1]\n', DEFAULT_FORMAT_SETTINGS, ctx({
      lineBeforeCursor: '> ',
      inBlockquote: true,
    }));
    expect(out).toBe('first\n> second');
  });

  it('applies an enabled paste-safe formatter rule', () => {
    const out = formatPaste('see...', { enabled: { 'proper-ellipsis': true }, configs: {} }, ctx());
    expect(out).toBe('see…');
  });

  it('does not touch a marker when the cursor is mid-line (no dedupe)', () => {
    const out = formatPaste('- item', DEFAULT_FORMAT_SETTINGS, ctx({ lineBeforeCursor: 'text' }));
    expect(out).toBe('- item');
  });
});
