import { describe, it, expect } from 'vitest';
import {
  canonicalSourceId,
  normalizeDoi,
  normalizeArxivId,
  normalizePubmedId,
  normalizeIsbn,
  normalizeUrl,
  shortHash,
} from '../../../src/main/sources/source-id';

describe('normalizeDoi (#90)', () => {
  it('returns the bare DOI for a plain input', () => {
    expect(normalizeDoi('10.1038/s41586-023-06924-6')).toBe('10.1038/s41586-023-06924-6');
  });

  it('strips https://doi.org/ prefix', () => {
    expect(normalizeDoi('https://doi.org/10.1038/s41586-023-06924-6'))
      .toBe('10.1038/s41586-023-06924-6');
  });

  it('strips http://dx.doi.org/ prefix', () => {
    expect(normalizeDoi('http://dx.doi.org/10.1000/xyz'))
      .toBe('10.1000/xyz');
  });

  it('strips `doi:` prefix', () => {
    expect(normalizeDoi('doi:10.1000/xyz')).toBe('10.1000/xyz');
  });

  it('lowercases', () => {
    expect(normalizeDoi('10.1038/S41586')).toBe('10.1038/s41586');
  });

  it('returns null for non-DOI input', () => {
    expect(normalizeDoi('not a doi')).toBeNull();
    expect(normalizeDoi('11.1234/foo')).toBeNull();
    expect(normalizeDoi('')).toBeNull();
  });
});

describe('normalizeArxivId (#90)', () => {
  it('accepts the new-style id', () => {
    expect(normalizeArxivId('2301.12345')).toBe('2301.12345');
  });

  it('strips the version suffix', () => {
    expect(normalizeArxivId('2301.12345v2')).toBe('2301.12345');
  });

  it('strips `arXiv:` prefix and lowercases', () => {
    expect(normalizeArxivId('arXiv:2301.12345V3')).toBe('2301.12345');
  });

  it('accepts old-style ids with `/` translated to `_`', () => {
    expect(normalizeArxivId('math/0512001')).toBe('math_0512001');
    expect(normalizeArxivId('cond-mat.stat-mech/0512123')).toBe('cond-mat.stat-mech_0512123');
  });

  it('returns null for malformed input', () => {
    expect(normalizeArxivId('not arxiv')).toBeNull();
    expect(normalizeArxivId('12345')).toBeNull();
  });
});

describe('normalizePubmedId (#90)', () => {
  it('accepts a bare numeric id', () => {
    expect(normalizePubmedId('12345678')).toBe('12345678');
  });

  it('strips `pmid:` prefix', () => {
    expect(normalizePubmedId('PMID:12345678')).toBe('12345678');
  });

  it('returns null for non-numeric input', () => {
    expect(normalizePubmedId('abc')).toBeNull();
    expect(normalizePubmedId('')).toBeNull();
  });
});

describe('normalizeIsbn (#90)', () => {
  it('accepts an ISBN-13 with valid checksum', () => {
    // The Pragmatic Programmer, 20th anniversary edition.
    expect(normalizeIsbn('9780135957059')).toBe('9780135957059');
  });

  it('accepts an ISBN-13 with hyphens', () => {
    expect(normalizeIsbn('978-0-13-595705-9')).toBe('9780135957059');
  });

  it('converts a valid ISBN-10 to ISBN-13', () => {
    // Structure and Interpretation of Computer Programs — ISBN-10 0262510871.
    const result = normalizeIsbn('0262510871');
    expect(result).toMatch(/^978\d{10}$/);
    expect(result).toBe('9780262510875');
  });

  it('accepts an ISBN-10 with trailing X', () => {
    // The Hobbit — ISBN-10 043942089X.
    const result = normalizeIsbn('043942089X');
    expect(result).toBe('9780439420891');
  });

  it('returns null when the checksum is wrong', () => {
    expect(normalizeIsbn('9780135957050')).toBeNull();
  });

  it('returns null for non-ISBN input', () => {
    expect(normalizeIsbn('not an isbn')).toBeNull();
    expect(normalizeIsbn('12345')).toBeNull();
  });
});

describe('normalizeUrl (#90)', () => {
  it('lowercases scheme and host', () => {
    expect(normalizeUrl('HTTP://Example.COM/Path')).toBe('http://example.com/Path');
  });

  it('strips `www.`', () => {
    expect(normalizeUrl('https://www.example.com/foo')).toBe('https://example.com/foo');
  });

  it('strips fragments', () => {
    expect(normalizeUrl('https://example.com/foo#section')).toBe('https://example.com/foo');
  });

  it('strips utm_* parameters', () => {
    expect(normalizeUrl('https://example.com/foo?utm_source=twitter&q=hello'))
      .toBe('https://example.com/foo?q=hello');
  });

  it('strips fbclid / gclid / mc_eid tracking params', () => {
    expect(normalizeUrl('https://example.com/foo?fbclid=123&gclid=456&mc_eid=789'))
      .toBe('https://example.com/foo');
  });

  it('preserves non-tracking query params (sorted alphabetically)', () => {
    expect(normalizeUrl('https://example.com/?q=search&page=2'))
      .toBe('https://example.com/?page=2&q=search');
  });

  it('sorts query params so `?a=1&b=2` and `?b=2&a=1` match', () => {
    expect(normalizeUrl('https://example.com/foo?b=2&a=1'))
      .toBe(normalizeUrl('https://example.com/foo?a=1&b=2'));
  });

  it('strips a trailing slash on a non-root path', () => {
    expect(normalizeUrl('https://example.com/foo/')).toBe('https://example.com/foo');
  });

  it('preserves the root slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns null for malformed input', () => {
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('canonicalSourceId (#90)', () => {
  it('prefers DOI over everything else', () => {
    const result = canonicalSourceId({
      doi: '10.1038/s41586-023-06924-6',
      arxiv: '2301.12345',
      url: 'https://example.com/paper',
    });
    expect(result.method).toBe('doi');
    expect(result.id).toBe('doi-10.1038_s41586-023-06924-6');
  });

  it('falls through DOI to arXiv when DOI is absent', () => {
    const result = canonicalSourceId({ arxiv: '2301.12345', url: 'https://example.com' });
    expect(result.method).toBe('arxiv');
    expect(result.id).toBe('arxiv-2301.12345');
  });

  it('falls through to pubmed', () => {
    const result = canonicalSourceId({ pubmed: '12345678' });
    expect(result.id).toBe('pmid-12345678');
  });

  it('falls through to ISBN', () => {
    const result = canonicalSourceId({ isbn: '9780135957059' });
    expect(result.id).toBe('isbn-9780135957059');
  });

  it('falls through to URL (hashed)', () => {
    const result = canonicalSourceId({ url: 'https://example.com/foo' });
    expect(result.method).toBe('url');
    expect(result.id).toMatch(/^url-[a-f0-9]{12}$/);
  });

  it('normalizes URL before hashing — `?utm_source=x` and no-utm match', () => {
    const a = canonicalSourceId({ url: 'https://example.com/foo?utm_source=x' });
    const b = canonicalSourceId({ url: 'https://example.com/foo' });
    expect(a.id).toBe(b.id);
  });

  it('falls through to content hash when nothing else is available', () => {
    const result = canonicalSourceId({}, 'some body content to hash');
    expect(result.method).toBe('hash');
    expect(result.id).toMatch(/^sha-[a-f0-9]{12}$/);
  });

  it('throws when no identifier and no seed is available', () => {
    expect(() => canonicalSourceId({})).toThrow();
  });

  it('ignores an invalid DOI and falls through to the next field', () => {
    const result = canonicalSourceId({ doi: 'not-a-doi', arxiv: '2301.12345' });
    expect(result.method).toBe('arxiv');
  });

  it('produces the same id for ISBN-10 and its equivalent ISBN-13', () => {
    const a = canonicalSourceId({ isbn: '0262510871' });
    const b = canonicalSourceId({ isbn: '9780262510875' });
    expect(a.id).toBe(b.id);
  });

  it('produces the same id for DOI across URL wrappings', () => {
    const a = canonicalSourceId({ doi: '10.1000/xyz' });
    const b = canonicalSourceId({ doi: 'https://doi.org/10.1000/xyz' });
    const c = canonicalSourceId({ doi: 'doi:10.1000/xyz' });
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(c.id);
  });
});

describe('shortHash', () => {
  it('is deterministic', () => {
    expect(shortHash('x')).toBe(shortHash('x'));
  });

  it('returns 12 hex chars', () => {
    expect(shortHash('hello world')).toMatch(/^[a-f0-9]{12}$/);
  });

  it('is different for different inputs', () => {
    expect(shortHash('a')).not.toBe(shortHash('b'));
  });
});
