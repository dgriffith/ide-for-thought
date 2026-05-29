import { describe, it, expect } from 'vitest';
import { buildExcerptNoteContent, buildExcerptAppendBlock } from '../../src/shared/excerpt-note';

describe('buildExcerptNoteContent (#101)', () => {
  it('renders frontmatter, heading, quote, and commentary slot', () => {
    const r = buildExcerptNoteContent({
      sourceId: 'toulmin-1958',
      excerpt: {
        excerptId: 'toulmin-1958-9a3d4d01e5a6',
        citedText: 'Arguments in any field of inquiry can usefully be analysed.',
        page: '12',
        pageRange: null,
        locationText: null,
      },
      source: {
        title: 'The Uses of Argument',
        uri: null,
        doi: null,
      },
    });
    expect(r.suggestedTitle).toBe('Note on The Uses of Argument');
    expect(r.content).toContain('about: [[sources/toulmin-1958]]');
    expect(r.content).toContain('quotes: [[quote::toulmin-1958-9a3d4d01e5a6]]');
    expect(r.content).toContain('# Note on');
    expect(r.content).toContain('> Arguments in any field of inquiry');
    expect(r.content).toContain('*p. 12*');
    expect(r.content).toContain('## Commentary');
  });

  it('falls back to sourceId when no source metadata is supplied', () => {
    const r = buildExcerptNoteContent({
      sourceId: 'abc-123',
      excerpt: { excerptId: 'abc-123-deadbeef', citedText: 'Hi.', page: null, pageRange: null, locationText: null },
    });
    expect(r.suggestedTitle).toBe('Note on abc-123');
    expect(r.content).toContain('# Note on abc-123');
  });

  it('respects an explicit titleOverride', () => {
    const r = buildExcerptNoteContent({
      sourceId: 'abc-123',
      excerpt: { excerptId: 'abc-123-deadbeef', citedText: 'Hi.', page: null, pageRange: null, locationText: null },
      titleOverride: 'My weekend reading',
    });
    expect(r.suggestedTitle).toBe('My weekend reading');
    expect(r.content).toContain('# My weekend reading');
  });

  it('prefers pageRange over page in the location hint', () => {
    const r = buildExcerptNoteContent({
      sourceId: 's',
      excerpt: { excerptId: 'e', citedText: 'x', page: '10', pageRange: '10-12', locationText: null },
    });
    expect(r.content).toContain('*pp. 10-12*');
    expect(r.content).not.toContain('*p. 10*');
  });

  it('falls back to locationText when no page info is present', () => {
    const r = buildExcerptNoteContent({
      sourceId: 's',
      excerpt: { excerptId: 'e', citedText: 'x', page: null, pageRange: null, locationText: 'Chapter 3, §4' },
    });
    expect(r.content).toContain('*Chapter 3, §4*');
  });

  it('omits the location line when none of page/pageRange/locationText are set', () => {
    const r = buildExcerptNoteContent({
      sourceId: 's',
      excerpt: { excerptId: 'e', citedText: 'x', page: null, pageRange: null, locationText: null },
    });
    expect(r.content).not.toMatch(/\*p/);
    expect(r.content).toContain('## Commentary');
  });

  it('preserves multi-line quotes as a single blockquote', () => {
    const r = buildExcerptNoteContent({
      sourceId: 's',
      excerpt: {
        excerptId: 'e',
        citedText: 'first line\n\nthird line',
        page: null, pageRange: null, locationText: null,
      },
    });
    expect(r.content).toMatch(/> first line\n>\n> third line/);
  });

  it('handles empty citedText without crashing — the body just has no quote', () => {
    const r = buildExcerptNoteContent({
      sourceId: 's',
      excerpt: { excerptId: 'e', citedText: '', page: null, pageRange: null, locationText: null },
    });
    expect(r.content).toContain('## Commentary');
    expect(r.content).not.toContain('>');
  });
});

describe('buildExcerptAppendBlock (#101)', () => {
  it('appends quote + quote-link + page hint', () => {
    const b = buildExcerptAppendBlock({
      excerptId: 'toulmin-1958-deadbeef',
      citedText: 'A short quote.',
      page: '12', pageRange: null, locationText: null,
    });
    expect(b).toBe('\n\n> A short quote.\n— [[quote::toulmin-1958-deadbeef]] · p. 12\n');
  });

  it('omits the page hint when there is none', () => {
    const b = buildExcerptAppendBlock({
      excerptId: 'e',
      citedText: 'Quote.',
      page: null, pageRange: null, locationText: null,
    });
    expect(b).toBe('\n\n> Quote.\n— [[quote::e]]\n');
  });

  it('still produces a usable block when citedText is empty', () => {
    const b = buildExcerptAppendBlock({
      excerptId: 'e',
      citedText: '',
      page: null, pageRange: null, locationText: null,
    });
    expect(b).toContain('[[quote::e]]');
  });
});
