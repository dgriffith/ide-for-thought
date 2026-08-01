/**
 * Inline `/book` sigil detection (#1065). The collision guarantees are the
 * point: it fires on a `/` at a word boundary, but NOT inside `[[…]]`
 * (wiki-links) and NOT on a path/URL slash.
 */
import { describe, it, expect } from 'vitest';
import { detectSlashPhase } from '../../../src/renderer/lib/editor/type-create-autocomplete';

/** Detect at the end of `before` (cursor = before.length). */
function at(before: string) {
  return detectSlashPhase(before, before.length);
}

describe('detectSlashPhase (#1065)', () => {
  it('fires on `/word` at a line start', () => {
    expect(at('/boo')).toEqual({ from: 0, prefix: 'boo' });
  });

  it('fires on `/` alone (empty prefix → full type list)', () => {
    expect(at('some text /')).toEqual({ from: 10, prefix: '' });
  });

  it('fires after whitespace mid-line', () => {
    expect(at('a note about /per')).toEqual({ from: 13, prefix: 'per' });
  });

  it('does NOT fire on a URL slash', () => {
    expect(at('see https://example.com/pa')).toBeNull();
  });

  it('does NOT fire on a path slash (no preceding whitespace)', () => {
    expect(at('folder/sub')).toBeNull();
  });

  it('does NOT fire inside an open `[[…]]` wiki-link', () => {
    expect(at('link to [[Some/No')).toBeNull();
    expect(at('[[cite::/x')).toBeNull();
  });

  it('fires again after a wiki-link has closed', () => {
    expect(at('[[Done]] then /bo')).toEqual({ from: 14, prefix: 'bo' });
  });

  it('stops once a space follows the sigil token (type already chosen)', () => {
    expect(at('/book ')).toBeNull();
  });
});
