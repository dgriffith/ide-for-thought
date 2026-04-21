import { describe, it, expect } from 'vitest';
import { parseCrossrefWork, type CrossrefWork } from '../../../../src/main/sources/api-adapters/crossref';

describe('parseCrossrefWork (#96)', () => {
  it('extracts title, authors, journal, publisher, abstract', () => {
    const work: CrossrefWork = {
      DOI: '10.1038/s41586-023-06924-6',
      type: 'journal-article',
      title: ['The Title of the Paper'],
      author: [
        { given: 'Alice', family: 'Smith' },
        { given: 'Bob', family: 'Jones' },
      ],
      'container-title': ['Nature'],
      publisher: 'Nature Publishing Group',
      issued: { 'date-parts': [[2024, 1, 15]] },
      abstract: '<jats:p>We describe the study.</jats:p>',
      URL: 'https://doi.org/10.1038/s41586-023-06924-6',
    };
    const meta = parseCrossrefWork(work, '10.1038/s41586-023-06924-6');
    expect(meta.title).toBe('The Title of the Paper');
    expect(meta.creators).toEqual(['Alice Smith', 'Bob Jones']);
    expect(meta.containerTitle).toBe('Nature');
    expect(meta.publisher).toBe('Nature Publishing Group');
    expect(meta.issued).toBe('2024-01-15');
    expect(meta.abstract).toBe('We describe the study.');
    expect(meta.subtype).toBe('Article');
    expect(meta.doi).toBe('10.1038/s41586-023-06924-6');
    expect(meta.uri).toBe('https://doi.org/10.1038/s41586-023-06924-6');
  });

  it('handles authors with only a `name` field (no given/family)', () => {
    const meta = parseCrossrefWork(
      { title: ['x'], author: [{ name: 'Single Name' }] },
      '10.1/x',
    );
    expect(meta.creators).toEqual(['Single Name']);
  });

  it('picks a year-only date when month/day absent', () => {
    const meta = parseCrossrefWork(
      { title: ['x'], issued: { 'date-parts': [[2020]] } },
      '10.1/x',
    );
    expect(meta.issued).toBe('2020');
  });

  it('falls back to published-print when `issued` is missing', () => {
    const meta = parseCrossrefWork(
      { title: ['x'], 'published-print': { 'date-parts': [[2022, 6]] } },
      '10.1/x',
    );
    expect(meta.issued).toBe('2022-06');
  });

  it('strips JATS tags and collapses whitespace in abstracts', () => {
    const meta = parseCrossrefWork(
      { title: ['x'], abstract: '<jats:p>First.\n\n</jats:p><jats:p>  Second.</jats:p>' },
      '10.1/x',
    );
    expect(meta.abstract).toBe('First. Second.');
  });

  it('maps CrossRef types to thought subtypes', () => {
    expect(parseCrossrefWork({ title: ['x'], type: 'journal-article' }, '10.1/x').subtype).toBe('Article');
    expect(parseCrossrefWork({ title: ['x'], type: 'book' }, '10.1/x').subtype).toBe('Book');
    expect(parseCrossrefWork({ title: ['x'], type: 'posted-content' }, '10.1/x').subtype).toBe('Preprint');
    expect(parseCrossrefWork({ title: ['x'], type: 'report' }, '10.1/x').subtype).toBe('Report');
    expect(parseCrossrefWork({ title: ['x'], type: 'unknown-type' }, '10.1/x').subtype).toBe('Source');
  });

  it('prefers the version-of-record PDF link when multiple are present', () => {
    const meta = parseCrossrefWork(
      {
        title: ['x'],
        link: [
          { URL: 'http://example.com/am.pdf', 'content-type': 'application/pdf', 'content-version': 'am' },
          { URL: 'http://example.com/vor.pdf', 'content-type': 'application/pdf', 'content-version': 'vor' },
        ],
      },
      '10.1/x',
    );
    expect(meta.pdfUrl).toBe('http://example.com/vor.pdf');
  });

  it('falls back to any PDF link when no `vor` is available', () => {
    const meta = parseCrossrefWork(
      {
        title: ['x'],
        link: [{ URL: 'http://example.com/only.pdf', 'content-type': 'application/pdf' }],
      },
      '10.1/x',
    );
    expect(meta.pdfUrl).toBe('http://example.com/only.pdf');
  });

  it('returns null pdfUrl when no PDF links are advertised', () => {
    const meta = parseCrossrefWork({ title: ['x'], link: [] }, '10.1/x');
    expect(meta.pdfUrl).toBeNull();
  });

  it('uses a default title when CrossRef record has none', () => {
    const meta = parseCrossrefWork({ author: [{ given: 'A', family: 'B' }] }, '10.1/x');
    expect(meta.title).toBe('(untitled)');
  });

  it('constructs a default DOI URL when `URL` field is missing', () => {
    const meta = parseCrossrefWork({ title: ['x'] }, '10.1000/xyz');
    expect(meta.uri).toBe('https://doi.org/10.1000/xyz');
  });
});
