import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../../../src/main/embeddings/chunk';

describe('chunkMarkdown', () => {
  it('splits a note into one chunk per heading with breadcrumbs', () => {
    const md = [
      '# Title', 'Intro line.', '',
      '## Background', 'Some background.', '',
      '### Prior work', 'Details here.', '',
      '## Method', 'How it works.',
    ].join('\n');
    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.heading)).toEqual([
      'Title',
      'Title > Background',
      'Title > Background > Prior work',
      'Title > Method',
    ]);
    // The heading line is part of the embedded text.
    expect(chunks[1].text).toContain('## Background');
    expect(chunks[1].text).toContain('Some background.');
    // Indices are sequential.
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it('captures preamble before the first heading as its own chunk', () => {
    const chunks = chunkMarkdown('Loose intro paragraph.\n\n# First\nBody.');
    expect(chunks[0].heading).toBe('');
    expect(chunks[0].text).toBe('Loose intro paragraph.');
  });

  it('strips frontmatter', () => {
    const chunks = chunkMarkdown('---\ntitle: X\ntags: [a]\n---\n# Head\nBody.');
    expect(chunks.every((c) => !c.text.includes('tags:'))).toBe(true);
    expect(chunks[0].heading).toBe('Head');
  });

  it('does not treat # inside a code fence as a heading', () => {
    const md = '# Real\ntext\n\n```python\n# this is a comment\nx = 1\n```\nmore';
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading).toBe('Real');
    expect(chunks[0].text).toContain('# this is a comment');
  });

  it('pops the heading stack correctly when levels decrease', () => {
    const md = '# A\n\n## B\n\n### C\n\n## D';
    const headings = chunkMarkdown(md).map((c) => c.heading);
    expect(headings).toEqual(['A', 'A > B', 'A > B > C', 'A > D']);
  });

  it('sub-splits an over-long section, preserving the breadcrumb', () => {
    const para = (n: number) => `Paragraph ${n} ` + 'word '.repeat(40);
    const md = '# Big\n\n' + [1, 2, 3, 4].map(para).join('\n\n');
    const chunks = chunkMarkdown(md, { maxChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.heading === 'Big')).toBe(true);
    expect(chunks.every((c) => c.text.length <= 200 + 50)).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('gives identical text the same hash and different text different hashes', () => {
    const a = chunkMarkdown('# H\nsame body');
    const b = chunkMarkdown('# H\nsame body');
    const c = chunkMarkdown('# H\ndifferent body');
    expect(a[0].hash).toBe(b[0].hash);
    expect(a[0].hash).not.toBe(c[0].hash);
  });

  it('returns [] for empty or whitespace-only content', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n\n  ')).toEqual([]);
    expect(chunkMarkdown('---\ntitle: x\n---\n')).toEqual([]);
  });
});
