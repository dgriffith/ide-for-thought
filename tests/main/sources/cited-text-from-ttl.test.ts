import { describe, it, expect } from 'vitest';
import { buildExcerptTtl, citedTextFromTtl } from '../../../src/main/sources/create-excerpt';

describe('citedTextFromTtl', () => {
  it('round-trips text through buildExcerptTtl, including escapes', () => {
    for (const text of [
      'a simple passage',
      'quotes "inside" and a backslash \\ here',
      'line one\nline two\ttabbed',
      'unicode — em dash and café',
    ]) {
      const ttl = buildExcerptTtl({ sourceId: 'src-1', citedText: text });
      expect(citedTextFromTtl(ttl)).toBe(text);
    }
  });

  it('returns null when there is no citedText', () => {
    expect(citedTextFromTtl('this: a thought:Excerpt .')).toBeNull();
  });
});
