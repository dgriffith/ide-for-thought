import { describe, it, expect } from 'vitest';
import { buildWikiLinkIndex } from '../../../src/shared/wiki-link-resolver';
import {
  findBrokenWikiRanges,
  isBrokenNoteLink,
} from '../../../src/renderer/lib/editor/broken-link-decorations';
import { scanLinks } from '../../../src/renderer/lib/editor/link-decorations';

// One `raft.md` note exists; everything else is missing.
const index = buildWikiLinkIndex([
  { relativePath: 'notes/raft.md', isDirectory: false },
], {});

/** Convenience: the single link in a one-link string. */
function onlyLink(text: string) {
  const [link] = scanLinks(text, 0);
  return link!;
}

describe('findBrokenWikiRanges (#1446 Phase 2)', () => {
  it('flags an unresolved note wiki-link', () => {
    const ranges = findBrokenWikiRanges('see [[missing]] here', 0, index);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(4); // start of `[[`
  });

  it('does not flag a link that resolves (fuzzy basename)', () => {
    expect(findBrokenWikiRanges('see [[raft]]', 0, index)).toHaveLength(0);
  });

  it('strips the #anchor before resolving — a missing heading is not a missing note', () => {
    expect(findBrokenWikiRanges('see [[raft#nonexistent-heading]]', 0, index)).toHaveLength(0);
    // …but a missing note WITH an anchor is still broken.
    expect(findBrokenWikiRanges('see [[ghost#intro]]', 0, index)).toHaveLength(1);
  });

  it('ignores cite:: / quote:: links (they target sources / excerpts, not notes)', () => {
    expect(findBrokenWikiRanges('[[cite::unknown-src]] [[quote::unknown-x]]', 0, index)).toHaveLength(0);
  });

  it('still flags a note-kind typed link (e.g. supports::)', () => {
    expect(findBrokenWikiRanges('[[supports::missing]]', 0, index)).toHaveLength(1);
  });

  it('ignores markdown links and bare URLs', () => {
    expect(findBrokenWikiRanges('[text](./x.md) and https://example.com', 0, index)).toHaveLength(0);
  });

  it('offsets ranges by the slice start', () => {
    const [r] = findBrokenWikiRanges('[[missing]]', 100, index);
    expect(r!.from).toBe(100);
  });
});

describe('isBrokenNoteLink', () => {
  it('is true for an unresolved untyped wiki-link', () => {
    expect(isBrokenNoteLink(onlyLink('[[missing]]'), index)).toBe(true);
  });
  it('is false for a resolved one', () => {
    expect(isBrokenNoteLink(onlyLink('[[raft]]'), index)).toBe(false);
  });
  it('is false for a cite:: link', () => {
    expect(isBrokenNoteLink(onlyLink('[[cite::x]]'), index)).toBe(false);
  });
  it('is false for a markdown link', () => {
    expect(isBrokenNoteLink(onlyLink('[t](u)'), index)).toBe(false);
  });
});
