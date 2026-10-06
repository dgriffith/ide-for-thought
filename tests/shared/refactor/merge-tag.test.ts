/**
 * Tag merge / rename content rewrite (#2430).
 *
 * The rewrite must change exactly what the indexer reads as the tag and
 * nothing else, so most cases here pair "this moved" with "this did not":
 * code spans, fences, URL fragments, headings, anchor links, prefixes that
 * merely start with the same letters, and other casings.
 */
import { describe, it, expect } from 'vitest';
import {
  assertTagMerge,
  cleanTagInput,
  mergeTagInContent,
  retargetTag,
  rewriteFrontmatterTags,
  rewriteInlineTags,
} from '../../../src/shared/refactor/merge-tag';
import { parseMarkdown } from '../../../src/main/graph/parser';

const FROM = 'ml';
const TO = 'machine-learning';
const merge = (s: string) => mergeTagInContent(s, FROM, TO);

/** Every tag the indexer sees: inline plus frontmatter `tags:`. */
function indexedTags(content: string): string[] {
  const parsed = parseMarkdown(content);
  const fm = parsed.frontmatter.tags;
  const fmTags = Array.isArray(fm) ? fm.filter((t): t is string => typeof t === 'string') : typeof fm === 'string' ? [fm] : [];
  return [...new Set([...parsed.tags, ...fmTags])].sort();
}

describe('retargetTag — the #466 prefix model', () => {
  it('moves the tag itself and everything nested under it', () => {
    expect(retargetTag('ml', FROM, TO)).toBe('machine-learning');
    expect(retargetTag('ml/nlp', FROM, TO)).toBe('machine-learning/nlp');
    expect(retargetTag('ml/nlp/bert', FROM, TO)).toBe('machine-learning/nlp/bert');
  });

  it('leaves a tag that only shares leading characters, a parent, and a sibling', () => {
    expect(retargetTag('mlops', FROM, TO)).toBeNull();
    expect(retargetTag('ml-ish', FROM, TO)).toBeNull();
    expect(retargetTag('ai', 'ai/ml', 'x')).toBeNull();
    expect(retargetTag('ai/nlp', 'ai/ml', 'x')).toBeNull();
  });

  it('is case-sensitive, like the graph', () => {
    expect(retargetTag('ML', FROM, TO)).toBeNull();
    expect(retargetTag('Ml/nlp', FROM, TO)).toBeNull();
  });

  it('can move a nested tag up, or a top-level tag down', () => {
    expect(retargetTag('ai/ml/nlp', 'ai/ml', 'ml')).toBe('ml/nlp');
    expect(retargetTag('ml/nlp', 'ml', 'ai/ml')).toBe('ai/ml/nlp');
  });
});

describe('validation', () => {
  it('strips one leading # and whitespace from typed input', () => {
    expect(cleanTagInput('  #machine-learning ')).toBe('machine-learning');
    expect(cleanTagInput('ai/ml')).toBe('ai/ml');
  });

  it('refuses names the indexer would not read as that tag', () => {
    expect(() => assertTagMerge('ml', 'machine learning')).toThrow(/not a valid tag name/);
    expect(() => assertTagMerge('ml', '1ml')).toThrow(/not a valid tag name/);
    expect(() => assertTagMerge('ml', 'ai//ml')).toThrow(/not a valid tag name/);
    expect(() => assertTagMerge('ml', 'ai/')).toThrow(/not a valid tag name/);
    expect(() => assertTagMerge('ml', '')).toThrow(/not a valid tag name/);
    expect(() => assertTagMerge('not a tag', 'x')).toThrow(/is not a tag name/);
  });

  it('refuses merging a tag into itself, but allows a case-only rename', () => {
    expect(() => assertTagMerge('ml', 'ml')).toThrow(/already called that/);
    expect(() => assertTagMerge('ml', 'ML')).not.toThrow();
  });
});

describe('rewriteInlineTags', () => {
  it('rewrites body tags at line start, after whitespace and at end of text', () => {
    const r = rewriteInlineTags('#ml first\nsee #ml and\t#ml', FROM, TO);
    expect(r.content).toBe('#machine-learning first\nsee #machine-learning and\t#machine-learning');
    expect(r.count).toBe(3);
  });

  it('rewrites nested tags, keeping their tail', () => {
    expect(rewriteInlineTags('on #ml/nlp and #ml/vision/cnn', FROM, TO).content)
      .toBe('on #machine-learning/nlp and #machine-learning/vision/cnn');
  });

  it('keeps punctuation that follows a tag', () => {
    expect(rewriteInlineTags('About #ml. Also (#ml) and #ml, then #ml!', FROM, TO).content)
      .toBe('About #machine-learning. Also (#ml) and #machine-learning, then #machine-learning!');
  });

  it('drops nothing when a tag has a trailing slash — only the name moves', () => {
    expect(rewriteInlineTags('see #ml/ there', FROM, TO).content).toBe('see #machine-learning/ there');
  });

  it('leaves inline code spans alone', () => {
    const s = 'code `#ml` and `x = "#ml"` but #ml';
    expect(rewriteInlineTags(s, FROM, TO).content).toBe('code `#ml` and `x = "#ml"` but #machine-learning');
  });

  it('leaves fenced code alone, including tags at the start of a fenced line', () => {
    const s = 'before #ml\n```python\n#ml is a comment\nprint("#ml")\n```\nafter #ml\n';
    expect(rewriteInlineTags(s, FROM, TO).content)
      .toBe('before #machine-learning\n```python\n#ml is a comment\nprint("#ml")\n```\nafter #machine-learning\n');
  });

  it('leaves URL fragments and markdown anchor links alone', () => {
    const s = [
      'https://example.com/page#ml',
      '<https://example.com/#ml>',
      '[link](https://example.com/a#ml) and [anchor](#ml)',
      'https://example.com/#ml/nlp',
    ].join('\n');
    expect(rewriteInlineTags(s, FROM, TO).content).toBe(s);
  });

  it('leaves headings alone (a heading is "# text", never "#text")', () => {
    const s = '# ml\n## ml heading\n### #ml in a heading';
    expect(rewriteInlineTags(s, FROM, TO).content).toBe('# ml\n## ml heading\n### #machine-learning in a heading');
  });

  it('leaves prefixes-of-words, other casings and malformed nesting alone', () => {
    const s = '#mlops #ML #Ml/nlp #ml-ish #ml/1bad';
    expect(rewriteInlineTags(s, FROM, TO).content).toBe(s);
  });

  it('rewrites a tag immediately after a code span, as the indexer reads it', () => {
    // "`x`#ml" strips to "#ml" after the preceding whitespace, so the indexer
    // indexes it; the merge must move it or the old tag survives.
    const s = 'see `x`#ml here';
    expect(indexedTags(s)).toContain('ml');
    expect(rewriteInlineTags(s, FROM, TO).content).toBe('see `x`#machine-learning here');
  });

  it('returns the same string when nothing matched', () => {
    const s = 'no tags here';
    const r = rewriteInlineTags(s, FROM, TO);
    expect(r.content).toBe(s);
    expect(r.count).toBe(0);
  });
});

describe('rewriteFrontmatterTags', () => {
  it('renames a frontmatter tag and keeps the other keys', () => {
    const s = '---\ntitle: Note\ntags:\n  - ml\n  - stats\n---\nBody\n';
    const r = rewriteFrontmatterTags(s, FROM, TO);
    expect(r.changed).toBe(true);
    expect(r.content).toContain('title: Note');
    expect(indexedTags(r.content)).toEqual(['machine-learning', 'stats']);
    expect(r.content.endsWith('Body\n')).toBe(true);
  });

  it('dedupes when the note already has the target, in either order', () => {
    for (const list of ['[ml, machine-learning]', '[machine-learning, ml]']) {
      const r = rewriteFrontmatterTags(`---\ntags: ${list}\n---\nx\n`, FROM, TO);
      expect(indexedTags(r.content)).toEqual(['machine-learning']);
      expect(parseMarkdown(r.content).frontmatter.tags).toEqual(['machine-learning']);
    }
  });

  it('dedupes two entries that merge to one name', () => {
    const r = rewriteFrontmatterTags('---\ntags: [ml/nlp, machine-learning/nlp, ml]\n---\n', FROM, TO);
    expect(parseMarkdown(r.content).frontmatter.tags).toEqual(['machine-learning/nlp', 'machine-learning']);
  });

  it('leaves a duplicate the user already had elsewhere in the list', () => {
    const r = rewriteFrontmatterTags('---\ntags: [stats, stats, ml]\n---\n', FROM, TO);
    expect(parseMarkdown(r.content).frontmatter.tags).toEqual(['stats', 'stats', 'machine-learning']);
  });

  it('handles a single-string tags value', () => {
    const r = rewriteFrontmatterTags('---\ntags: ml/nlp\n---\nx\n', FROM, TO);
    expect(parseMarkdown(r.content).frontmatter.tags).toBe('machine-learning/nlp');
  });

  it('is a no-op without the tag, without frontmatter, or on malformed YAML', () => {
    for (const s of ['---\ntags: [stats]\n---\n', 'no frontmatter #ml', '---\ntags: [ml\n---\nbroken\n']) {
      const r = rewriteFrontmatterTags(s, FROM, TO);
      expect(r.changed).toBe(false);
      expect(r.content).toBe(s);
    }
  });
});

describe('mergeTagInContent — the whole note', () => {
  it('moves frontmatter, inline and nested usages and leaves code untouched', () => {
    const s = [
      '---',
      'tags: [ml, machine-learning, stats]',
      '---',
      '# Notes on #ml',
      '',
      'Using #ml/nlp today, and #mlops is different.',
      '',
      '```',
      '#ml stays in code',
      '```',
      'Inline `#ml` stays. Link: https://x.org/#ml',
      '',
    ].join('\n');
    const r = merge(s);
    expect(r.changed).toBe(true);
    expect(indexedTags(r.content)).toEqual(['machine-learning', 'machine-learning/nlp', 'mlops', 'stats']);
    expect(r.content).toContain('```\n#ml stays in code\n```');
    expect(r.content).toContain('Inline `#ml` stays. Link: https://x.org/#ml');
    expect(r.content).toContain('# Notes on #machine-learning');
  });

  it('after the merge the indexer sees no trace of the old tag', () => {
    const s = '---\ntags: ml\n---\nText #ml #ml/a/b\n';
    const before = indexedTags(s);
    expect(before).toEqual(['ml', 'ml/a/b']);
    const after = indexedTags(merge(s).content);
    expect(after).toEqual(['machine-learning', 'machine-learning/a/b']);
  });

  it('reports unchanged and returns the input byte-for-byte when the note lacks the tag', () => {
    const s = '---\ntags: [stats]   # a comment\n---\n#mlops only\n';
    const r = merge(s);
    expect(r.changed).toBe(false);
    expect(r.content).toBe(s);
  });

  it('does not rewrite the frontmatter block of a note that only has the tag inline', () => {
    // YAML is re-serialized only when `tags:` itself changes; a note tagged
    // only in its body keeps its frontmatter formatting exactly.
    const s = '---\ntitle:   "Spaced"   # keep me\n---\nbody #ml\n';
    expect(merge(s).content).toBe('---\ntitle:   "Spaced"   # keep me\n---\nbody #machine-learning\n');
  });

  it('supports a case-only rename', () => {
    expect(mergeTagInContent('a #ml b', 'ml', 'ML').content).toBe('a #ML b');
  });
});
