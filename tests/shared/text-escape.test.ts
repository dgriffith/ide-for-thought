/**
 * Canonical escaping helpers (#1917), hoisted from ~25 duplicated copies.
 * `escapeHtml` and `escapeHtmlFull` are genuinely different behaviors kept
 * side by side — see the module docstring — so both are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr, escapeHtmlFull, escapeRegex } from '../../src/shared/text-escape';

describe('escapeHtml', () => {
  it('escapes &, <, >', () => {
    expect(escapeHtml('<a href="x">Tom & Jerry</a>')).toBe('&lt;a href="x"&gt;Tom &amp; Jerry&lt;/a&gt;');
  });

  it('leaves quotes untouched', () => {
    expect(escapeHtml(`it's "fine"`)).toBe(`it's "fine"`);
  });
});

describe('escapeAttr', () => {
  it('escapes &, <, >, " but not a bare apostrophe', () => {
    expect(escapeAttr(`Tom & Jerry's "Show"`)).toBe('Tom &amp; Jerry\'s &quot;Show&quot;');
  });
});

describe('escapeHtmlFull', () => {
  it('escapes &, <, >, ", and \'', () => {
    expect(escapeHtmlFull(`Tom & Jerry's "Show"`)).toBe('Tom &amp; Jerry&#39;s &quot;Show&quot;');
  });
});

describe('escapeRegex', () => {
  it('escapes every RegExp metacharacter', () => {
    const literal = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(literal);
    expect(new RegExp(escaped).test(literal)).toBe(true);
  });

  it('leaves plain text untouched', () => {
    expect(escapeRegex('plain text 123')).toBe('plain text 123');
  });
});
