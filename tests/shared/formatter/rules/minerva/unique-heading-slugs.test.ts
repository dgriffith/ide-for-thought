import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/minerva/unique-heading-slugs';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'unique-heading-slugs': true },
  configs: {},
};

describe('unique-heading-slugs (#161)', () => {
  it('suffixes a duplicate H2', () => {
    const src = '## Overview\n\nbody\n\n## Overview\n\nmore\n';
    const out = formatContent(src, enabled);
    expect(out).toContain('## Overview\n');
    expect(out).toContain('## Overview 2\n');
  });

  it('handles multiple duplicates sequentially', () => {
    const src = '# Intro\n\n# Intro\n\n# Intro\n';
    const out = formatContent(src, enabled);
    expect(out).toContain('# Intro\n');
    expect(out).toContain('# Intro 2\n');
    expect(out).toContain('# Intro 3\n');
  });

  it('treats case differences as collisions (slug is lowercase)', () => {
    const src = '## foo\n\n## FOO\n';
    const out = formatContent(src, enabled);
    expect(out).toContain('## foo\n');
    expect(out).toContain('## FOO 2\n');
  });

  it('leaves unique headings alone', () => {
    const src = '# A\n\n## B\n\n### C\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('respects headings across levels as separate (H1 and H2 with same text both collide)', () => {
    // Slugs are derived from text, not level — so `# Overview` and
    // `## Overview` clash on the same slug.
    const src = '# Overview\n\n## Overview\n';
    const out = formatContent(src, enabled);
    expect(out).toContain('# Overview\n');
    expect(out).toContain('## Overview 2\n');
  });

  it('does not touch `#` inside a code fence', () => {
    const src = '# Intro\n\n```\n# Intro\n# Intro\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('# Intro\n\n# Intro\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
