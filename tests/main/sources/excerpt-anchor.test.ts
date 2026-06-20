/**
 * Best-effort selection → body.md anchoring for the clipper (#794).
 */

import { describe, it, expect } from 'vitest';
import { locateExcerptOffsets } from '../../../src/main/sources/excerpt-anchor';

describe('locateExcerptOffsets', () => {
  const body = 'The quick brown fox\njumps over the lazy dog.\n';

  it('anchors an exact selection to its body.md offsets', () => {
    const off = locateExcerptOffsets(body, 'quick brown fox');
    expect(off).toEqual({ charStart: 4, charEnd: 19 });
    expect(body.slice(off!.charStart, off!.charEnd)).toBe('quick brown fox');
  });

  it('matches whitespace-tolerantly across newlines and runs', () => {
    // Selection as the browser hands it over: collapsed spaces, no newline.
    const off = locateExcerptOffsets(body, 'brown fox jumps over');
    expect(off).not.toBeNull();
    // The matched span in body.md spans the newline that the selection flattened.
    expect(body.slice(off!.charStart, off!.charEnd)).toBe('brown fox\njumps over');
  });

  it('ignores leading/trailing whitespace on the selection', () => {
    const off = locateExcerptOffsets(body, '   quick brown   ');
    expect(off).not.toBeNull();
    expect(body.slice(off!.charStart, off!.charEnd)).toBe('quick brown');
  });

  it('sees through markdown markers wrapping the selection', () => {
    const md = 'A paragraph with **emphasised text** in the middle.';
    const off = locateExcerptOffsets(md, 'emphasised text');
    expect(off).not.toBeNull();
    expect(md.slice(off!.charStart, off!.charEnd)).toBe('emphasised text');
  });

  it('returns null when the selection is absent', () => {
    expect(locateExcerptOffsets(body, 'not present here')).toBeNull();
  });

  it('returns null when the selection is ambiguous (multiple matches)', () => {
    expect(locateExcerptOffsets('cat dog cat', 'cat')).toBeNull();
  });

  it('returns null for an empty / whitespace-only selection', () => {
    expect(locateExcerptOffsets(body, '   ')).toBeNull();
    expect(locateExcerptOffsets(body, '')).toBeNull();
  });

  it('returns null when markup interrupts the selection mid-phrase', () => {
    // "the big dog" is not a clean substring of "the **big** dog".
    const md = 'the **big** dog';
    expect(locateExcerptOffsets(md, 'the big dog')).toBeNull();
  });
});
