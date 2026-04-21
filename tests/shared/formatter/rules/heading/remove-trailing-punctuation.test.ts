import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/heading/remove-trailing-punctuation';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'remove-trailing-punctuation-in-heading': true },
  configs: {},
};

describe('remove-trailing-punctuation-in-heading (#156)', () => {
  it('strips a trailing period', () => {
    expect(formatContent('## Heading.\n', enabled)).toBe('## Heading\n');
  });

  it('strips a trailing comma, colon, and semicolon', () => {
    expect(formatContent('# A,\n## B:\n### C;\n', enabled)).toBe(
      '# A\n## B\n### C\n',
    );
  });

  it('strips a run of mixed trailing punctuation', () => {
    expect(formatContent('## Hello.,;:\n', enabled)).toBe('## Hello\n');
  });

  it('keeps `?` and `!` trailing punctuation', () => {
    expect(formatContent('## Is this a question?\n## Yes!\n', enabled)).toBe(
      '## Is this a question?\n## Yes!\n',
    );
  });

  it('does not strip internal punctuation', () => {
    expect(formatContent('## A, B, and C\n', enabled)).toBe('## A, B, and C\n');
  });

  it('preserves trailing whitespace (trailing-spaces rule cleans it up)', () => {
    expect(formatContent('## Heading.   \n', enabled)).toBe('## Heading   \n');
  });

  it('does not touch headings inside a code fence', () => {
    const src = '```\n## Heading.\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('## Heading.\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
