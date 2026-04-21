import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/content/default-language-for-code-fences';
import { formatContent } from '../../../../../src/shared/formatter/engine';

function run(content: string, defaultLanguage?: string) {
  return formatContent(content, {
    enabled: { 'default-language-for-code-fences': true },
    configs:
      defaultLanguage !== undefined
        ? { 'default-language-for-code-fences': { defaultLanguage } }
        : {},
  });
}

describe('default-language-for-code-fences (#157)', () => {
  it('tags a bare ``` fence with the default language (`text`)', () => {
    expect(run('```\nfoo\n```\n')).toBe('```text\nfoo\n```\n');
  });

  it('leaves a fence with an existing info string alone', () => {
    const src = '```js\nconst x = 1;\n```\n';
    expect(run(src)).toBe(src);
  });

  it('honours a non-default language', () => {
    expect(run('```\nfoo\n```\n', 'plaintext')).toBe('```plaintext\nfoo\n```\n');
  });

  it('works with tilde fences', () => {
    expect(run('~~~\nfoo\n~~~\n')).toBe('~~~text\nfoo\n~~~\n');
  });

  it('no-op when configured language is empty', () => {
    const src = '```\nfoo\n```\n';
    expect(run(src, '')).toBe(src);
  });

  it('handles multiple bare fences in the same document', () => {
    const src = '```\na\n```\n\n```\nb\n```\n';
    expect(run(src)).toBe('```text\na\n```\n\n```text\nb\n```\n');
  });

  it('is idempotent', () => {
    const once = run('```\nfoo\n```\n');
    expect(run(once)).toBe(once);
  });
});
