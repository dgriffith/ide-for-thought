/**
 * Default-body helpers for the type editor (#2493): chip names, insert at the
 * caret, and the "how a new note starts" preview.
 */
import { describe, it, expect } from 'vitest';
import { insertPlaceholder, templatePreview, templatePropertyNames } from '../../../src/renderer/lib/components/type-editor-value';

describe('templatePropertyNames', () => {
  it('lists inherited names first, then own, de-duplicated', () => {
    expect(templatePropertyNames(['category', 'city'], ['address', 'city'])).toEqual(['address', 'city', 'category']);
    expect(templatePropertyNames(['a', '', 'a'])).toEqual(['a']);
  });
});

describe('insertPlaceholder', () => {
  it('replaces the selection and puts the caret after the token', () => {
    expect(insertPlaceholder('At X.', 3, 4, 'city')).toEqual({ text: 'At {{city}}.', caret: 11 });
    expect(insertPlaceholder('', 0, 0, 'title')).toEqual({ text: '{{title}}', caret: 9 });
  });
});

describe('templatePreview', () => {
  it('shows samples for properties, the type for title, today for date, and drops cursor', () => {
    const lines = templatePreview('# {{title}}\n\n{{cursor}}At {{city}} on {{date}}\n{{unknown}}', 'Shop', ['city'], new Date('2026-10-02T12:00:00Z'));
    expect(lines).toEqual(['# New Shop', 'At ‹city› on 2026-10-02', '{{unknown}}']);
  });
  it('is empty for an empty body', () => {
    expect(templatePreview('', 'Shop', [])).toEqual([]);
  });
});
