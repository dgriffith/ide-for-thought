import { describe, it, expect } from 'vitest';
import { topRelatedNotes } from '../../../src/main/embeddings/related';
import type { RelatedHit } from '../../../src/main/embeddings/vector-store';

const hit = (notePath: string, sectionHeading: string, score: number, chunkText = 'body text'): RelatedHit =>
  ({ notePath, sectionHeading, chunkText, score });

describe('topRelatedNotes', () => {
  const titleOf = (p: string) => p.replace(/\.md$/, '').toUpperCase();

  it('keeps one row per note — the best-scoring section', () => {
    const out = topRelatedNotes(
      [hit('a.md', 'Intro', 0.4), hit('a.md', 'Deep', 0.8), hit('b.md', 'X', 0.6)],
      { limit: 10, titleOf },
    );
    expect(out).toHaveLength(2);
    const a = out.find((n) => n.relativePath === 'a.md')!;
    expect(a.score).toBe(0.8);
    expect(a.sectionHeading).toBe('Deep');
  });

  it('ranks by score descending and caps at the limit', () => {
    const out = topRelatedNotes(
      [hit('a.md', 'h', 0.3), hit('b.md', 'h', 0.9), hit('c.md', 'h', 0.6)],
      { limit: 2, titleOf },
    );
    expect(out.map((n) => n.relativePath)).toEqual(['b.md', 'c.md']);
  });

  it('enriches with title and a collapsed snippet', () => {
    const out = topRelatedNotes(
      [hit('notes/topic.md', 'Sec', 0.5, '  multi\n  line   text  ')],
      { limit: 1, titleOf },
    );
    expect(out[0].title).toBe('NOTES/TOPIC');
    expect(out[0].snippet).toBe('multi line text');
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
