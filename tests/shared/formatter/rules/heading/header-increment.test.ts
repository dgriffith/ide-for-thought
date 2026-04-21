import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/heading/header-increment';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = { enabled: { 'header-increment': true }, configs: {} };

describe('header-increment (#156)', () => {
  it('bumps H1 → H3 down to H1 → H2', () => {
    expect(formatContent('# A\n### B\n', enabled)).toBe('# A\n## B\n');
  });

  it('accepts the first heading at any level', () => {
    expect(formatContent('### start here\n', enabled)).toBe('### start here\n');
  });

  it('leaves monotonically-stepping headings alone', () => {
    const src = '# A\n## B\n### C\n#### D\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('allows jumps back up (H3 → H1)', () => {
    const src = '# A\n## B\n### C\n# next section\n## sub\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('clamps after a shallow-then-deep jump over multiple levels', () => {
    expect(formatContent('# A\n#### B\n', enabled)).toBe('# A\n## B\n');
  });

  it('accepts H3 as the first heading and then enforces stepping from there', () => {
    expect(formatContent('### A\n##### B\n', enabled)).toBe('### A\n#### B\n');
  });

  it('does not touch `#` inside a code fence', () => {
    const src = '# A\n```\n### not a heading\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not treat `#hashtag` as a heading', () => {
    expect(formatContent('# A\n#hashtag\n### C\n', enabled)).toBe(
      '# A\n#hashtag\n## C\n',
    );
  });

  it('is idempotent', () => {
    const once = formatContent('# A\n### B\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
