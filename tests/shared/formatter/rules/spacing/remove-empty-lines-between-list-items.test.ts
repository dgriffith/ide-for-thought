import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/spacing/remove-empty-lines-between-list-items';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'remove-empty-lines-between-list-markers-and-checklists': true },
  configs: {},
};

describe('remove-empty-lines-between-list-markers-and-checklists (#158)', () => {
  it('compacts two unordered list items separated by a blank line', () => {
    expect(formatContent('- one\n\n- two\n', enabled)).toBe('- one\n- two\n');
  });

  it('compacts a regular item followed by a checklist item', () => {
    expect(formatContent('- plain\n\n- [ ] task\n', enabled)).toBe(
      '- plain\n- [ ] task\n',
    );
  });

  it('compacts checklist items with different states', () => {
    expect(formatContent('- [x] done\n\n- [ ] todo\n', enabled)).toBe(
      '- [x] done\n- [ ] todo\n',
    );
  });

  it('handles ordered lists', () => {
    expect(formatContent('1. one\n\n2. two\n', enabled)).toBe('1. one\n2. two\n');
  });

  it('collapses multiple blank lines between items', () => {
    expect(formatContent('- a\n\n\n\n- b\n', enabled)).toBe('- a\n- b\n');
  });

  it('preserves blank lines before prose after a list', () => {
    const src = '- a\n- b\n\nparagraph\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('preserves blank lines between a list and non-list content', () => {
    const src = '- a\n\nparagraph\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not touch list-looking lines inside a code fence', () => {
    const src = '```\n- a\n\n- b\n```\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('- a\n\n- b\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
