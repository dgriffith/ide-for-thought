// @vitest-environment jsdom
/**
 * Cite / quote / footnote metadata helpers (#672).
 */
import { describe, it, expect } from 'vitest';
import {
  collapseCiteRows,
  formatFullByline,
  buildCiteTooltip,
  buildQuoteTooltip,
  buildFootnoteTooltip,
  buildNotePreviewTooltip,
  buildNotePreviewMissing,
  type CiteMeta,
} from '../../../src/renderer/lib/preview/cite-meta';

describe('collapseCiteRows', () => {
  it('dedups creators, takes first title / year-from-issued / doi / uri', () => {
    const meta = collapseCiteRows([
      { title: 'First Title', creator: 'Ada', issued: '2001-05-01', doi: '10.1/x', uri: 'http://a' },
      { title: 'Ignored Title', creator: 'Ada', issued: '1999', doi: '10.2/y', uri: 'http://b' },
      { creator: 'Babbage' },
    ]);
    expect(meta).toEqual({
      title: 'First Title',
      creators: ['Ada', 'Babbage'],
      year: '2001',
      doi: '10.1/x',
      uri: 'http://a',
    });
  });
  it('returns an empty creators array for no rows', () => {
    expect(collapseCiteRows([])).toEqual({ creators: [] });
  });
});

describe('formatFullByline', () => {
  it('returns empty for no creators and no year', () => {
    expect(formatFullByline([])).toBe('');
  });
  it('joins 1-3 creators', () => {
    expect(formatFullByline(['Ada', 'Babbage', 'Lovelace'])).toBe('Ada, Babbage, Lovelace');
  });
  it('truncates more than 3 creators with an ellipsis', () => {
    expect(formatFullByline(['A', 'B', 'C', 'D'])).toBe('A, B, C, …');
  });
  it('appends the year with a separator when present', () => {
    expect(formatFullByline(['Ada'], '2001')).toBe('Ada · 2001');
  });
  it('returns just the year when there are no creators', () => {
    expect(formatFullByline([], '2001')).toBe('2001');
  });
});

describe('buildCiteTooltip', () => {
  it('renders title, byline, and DOI with escaped fields', () => {
    const meta: CiteMeta = { title: 'A & B', creators: ['Ada'], year: '2001', doi: '10.1/<x>' };
    const html = buildCiteTooltip(meta);
    expect(html).toContain('A &amp; B');
    expect(html).toContain('Ada · 2001');
    expect(html).toContain('DOI: 10.1/&lt;x&gt;');
  });
  it('falls back to the uri when there is no doi', () => {
    const html = buildCiteTooltip({ creators: [], uri: 'http://example.com' });
    expect(html).toContain('http://example.com');
  });
  it('shows a fallback when there is no metadata', () => {
    expect(buildCiteTooltip({ creators: [] })).toContain('No metadata available');
  });
});

describe('buildQuoteTooltip', () => {
  it('renders cited text, byline, and page location with escaping', () => {
    const html = buildQuoteTooltip({
      citedText: 'a < b',
      sourceTitle: 'Title',
      sourceCreator: 'Ada',
      sourceYear: '2001',
      page: '42',
    });
    expect(html).toContain('a &lt; b');
    expect(html).toContain('Title — Ada (2001)');
    expect(html).toContain('p. 42');
  });
  it('prefers a page range over a single page', () => {
    const html = buildQuoteTooltip({ pageRange: '10-12', page: '10' });
    expect(html).toContain('pp. 10-12');
  });
  it('shows a fallback when there is no excerpt metadata', () => {
    expect(buildQuoteTooltip({})).toContain('No excerpt metadata available');
  });
});

describe('buildFootnoteTooltip', () => {
  it('strips the backref and keeps the body text', () => {
    const li = document.createElement('li');
    li.innerHTML = '<p>body text <a class="footnote-backref" href="#fnref1">↩</a></p>';
    const html = buildFootnoteTooltip(li);
    expect(html).toContain('body text');
    expect(html).not.toContain('footnote-backref');
    expect(html).not.toContain('↩');
    expect(html.startsWith('<div class="tt-footnote">')).toBe(true);
  });
});

describe('buildNotePreviewTooltip (#1132)', () => {
  it('renders title + snippet with escaped HTML', () => {
    const html = buildNotePreviewTooltip('The <b>Topic</b>', 'a & b < c');
    expect(html).toContain('<div class="tt-title">The &lt;b&gt;Topic&lt;/b&gt;</div>');
    expect(html).toContain('<div class="tt-note-body">a &amp; b &lt; c</div>');
  });
  it('shows an empty-note placeholder when the snippet is blank', () => {
    expect(buildNotePreviewTooltip('T', '')).toContain('(empty note)');
  });
  it('buildNotePreviewMissing is a quiet not-found', () => {
    const html = buildNotePreviewMissing('ghost');
    expect(html).toContain('tt-note-missing');
    expect(html).toContain('ghost');
    expect(html).toContain('not found');
  });
});
