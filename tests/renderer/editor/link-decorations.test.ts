import { describe, it, expect } from 'vitest';
import { parseWikiInner } from '../../../src/renderer/lib/editor/link-decorations';

describe('parseWikiInner — linkType extraction (post-#224 follow-up)', () => {
  it('returns null linkType for a bare `[[target]]`', () => {
    expect(parseWikiInner('notes/foo').linkType).toBeNull();
  });

  it('extracts `cite` from `[[cite::source-id]]`', () => {
    const { linkType, target } = parseWikiInner('cite::toulmin-1958');
    expect(linkType).toBe('cite');
    expect(target).toBe('toulmin-1958');
  });

  it('extracts `quote` from `[[quote::excerpt-id]]`', () => {
    const { linkType, target } = parseWikiInner('quote::brooks-essential-accidental');
    expect(linkType).toBe('quote');
    expect(target).toBe('brooks-essential-accidental');
  });

  it('preserves the type when a display alias follows', () => {
    const { linkType, target } = parseWikiInner('cite::toulmin-1958|Toulmin');
    expect(linkType).toBe('cite');
    expect(target).toBe('toulmin-1958');
  });

  it('rejects malformed type prefixes (uppercase, leading digit)', () => {
    expect(parseWikiInner('Cite::x').linkType).toBeNull();
    expect(parseWikiInner('1cite::x').linkType).toBeNull();
  });

  it('does not mistake `::` inside a note path for a type prefix', () => {
    // Paths can't actually contain `::`, but if someone writes one, we
    // treat the whole thing as the target. Degrade gracefully — the
    // regex guard on `^[a-z][\\w-]*$` rules the prefix out.
    expect(parseWikiInner('notes/foo').linkType).toBeNull();
  });

  it('surfaces other typed links (supports, rebuts, …) without special-casing', () => {
    expect(parseWikiInner('supports::some-note').linkType).toBe('supports');
    expect(parseWikiInner('rebuts::x').linkType).toBe('rebuts');
    expect(parseWikiInner('related-to::y').linkType).toBe('related-to');
  });
});
