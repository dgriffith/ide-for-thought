/**
 * Pure display helpers extracted from ConversationsPanel (#672).
 */
import { describe, it, expect } from 'vitest';
import {
  tabTitle,
  formatPropertyValue,
  sourceLabel,
  basename,
  sourceKindLabel,
} from '../../src/renderer/lib/conversations/conversation-display';

const conv = (msgs: { role: string; content: string }[]) => ({ conversation: { messages: msgs } });

describe('tabTitle', () => {
  it('uses an explicit title verbatim', () => {
    expect(tabTitle({ title: 'My chat', ...conv([]) })).toBe('My chat');
  });
  it('falls back to "New conversation" with no user message or empty content', () => {
    expect(tabTitle({ title: null, ...conv([]) })).toBe('New conversation');
    expect(tabTitle({ title: null, ...conv([{ role: 'user', content: '   ' }]) })).toBe('New conversation');
  });
  it('previews the first user message, whitespace-flattened', () => {
    expect(tabTitle({ title: null, ...conv([{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'a\n  b   c' }]) }))
      .toBe('a b c');
  });
  it('truncates >60 chars on a word boundary in the last quarter, else hard', () => {
    const wordy = 'one two three four five six seven eight nine ten eleven twelve thirteen';
    const t = tabTitle({ title: null, ...conv([{ role: 'user', content: wordy }]) });
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(61);
    expect(wordy.startsWith(t.slice(0, -1))).toBe(true); // a real prefix of the input
    expect(wordy[t.length - 1]).toBe(' '); // cut fell on a word boundary (no mid-word slice)
    // No late space → hard cut at 60 + …
    const nospace = 'x'.repeat(80);
    expect(tabTitle({ title: null, ...conv([{ role: 'user', content: nospace }]) })).toBe('x'.repeat(60) + '…');
  });
});

describe('formatPropertyValue', () => {
  it('renders deletes, primitives, and JSON', () => {
    expect(formatPropertyValue(null)).toBe('⌫ deleted');
    expect(formatPropertyValue('hi')).toBe('hi');
    expect(formatPropertyValue(42)).toBe('42');
    expect(formatPropertyValue(true)).toBe('true');
    expect(formatPropertyValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('sourceLabel + basename', () => {
  it('prefers identifier, then url, then placeholder', () => {
    expect(sourceLabel({ identifier: '10.1/x' })).toBe('10.1/x');
    expect(sourceLabel({ url: 'http://e.com' })).toBe('http://e.com');
    expect(sourceLabel({})).toBe('(unknown source)');
  });
  it('basename returns the last path segment', () => {
    expect(basename('notes/sources/a.md')).toBe('a.md');
    expect(basename('top.md')).toBe('top.md');
  });
});

describe('sourceKindLabel', () => {
  it('classifies url / doi / arxiv / pmid / id', () => {
    expect(sourceKindLabel({ url: 'http://e.com' })).toBe('url');
    expect(sourceKindLabel({ identifier: 'doi:10.1145/x' })).toBe('doi');
    expect(sourceKindLabel({ identifier: 'arxiv:2401.01234' })).toBe('arxiv');
    expect(sourceKindLabel({ identifier: 'pmid:12345678' })).toBe('pmid');
    expect(sourceKindLabel({ identifier: 'something-else' })).toBe('id');
  });
});
