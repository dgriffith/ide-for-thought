import { describe, it, expect } from 'vitest';
import { topRelatedNotes } from '../../../src/main/embeddings/related';
import type { RelatedHit, RefKind } from '../../../src/main/embeddings/vector-store';

const hit = (ref: string, sectionHeading: string, score: number, chunkText = 'body text', kind: RefKind = 'note'): RelatedHit =>
  ({ kind, ref, sectionHeading, chunkText, score });

describe('topRelatedNotes', () => {
  const titleOf = (h: RelatedHit) => h.ref.replace(/\.md$/, '').toUpperCase();

  it('keeps one row per ref — the best-scoring section', () => {
    const out = topRelatedNotes(
      [hit('a.md', 'Intro', 0.4), hit('a.md', 'Deep', 0.8), hit('b.md', 'X', 0.6)],
      { limit: 10, titleOf },
    );
    expect(out).toHaveLength(2);
    const a = out.find((n) => n.ref === 'a.md')!;
    expect(a.score).toBe(0.8);
    expect(a.sectionHeading).toBe('Deep');
  });

  it('does not merge a note and a source that share an id string', () => {
    const out = topRelatedNotes(
      [hit('x', 'h', 0.5, 'note body', 'note'), hit('x', 'h', 0.9, 'source body', 'source')],
      { limit: 10, titleOf },
    );
    expect(out).toHaveLength(2);
    expect(out.map((n) => n.kind).sort()).toEqual(['note', 'source']);
  });

  it('ranks by score descending and caps at the limit', () => {
    const out = topRelatedNotes(
      [hit('a.md', 'h', 0.3), hit('b.md', 'h', 0.9), hit('c.md', 'h', 0.6)],
      { limit: 2, titleOf },
    );
    expect(out.map((n) => n.ref)).toEqual(['b.md', 'c.md']);
  });

  it('carries kind through and enriches with title + collapsed snippet', () => {
    const out = topRelatedNotes(
      [hit('arxiv-1234', 'Sec', 0.5, '  multi\n  line   text  ', 'source')],
      { limit: 1, titleOf: () => 'A Paper Title' },
    );
    expect(out[0]).toMatchObject({ kind: 'source', ref: 'arxiv-1234', title: 'A Paper Title', snippet: 'multi line text' });
  });

  it('truncates a long snippet to 160 chars', () => {
    const long = 'word '.repeat(100);
    const out = topRelatedNotes([hit('a.md', 'h', 0.5, long)], { limit: 1, titleOf });
    expect(out[0].snippet.length).toBeLessThanOrEqual(160);
  });

  it('returns [] for no hits', () => {
    expect(topRelatedNotes([], { limit: 5, titleOf })).toEqual([]);
  });
});
