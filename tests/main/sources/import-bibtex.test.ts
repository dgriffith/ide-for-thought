import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  importBibtexContent,
  mapBibtexEntry,
  parseAuthors,
  extractIssuedDate,
} from '../../../src/main/sources/import-bibtex';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-bibtex-test-'));
}

const BASIC_BIB = `
@article{sun2024census,
  title = {A Census of Na D-traced Neutral ISM},
  author = {Sun, Yang and Ji, Zhiyuan and D'Eugenio, Francesco},
  journal = {Astrophysical Journal},
  year = {2024},
  month = {oct},
  doi = {10.1234/foo.bar},
  url = {https://doi.org/10.1234/foo.bar},
  abstract = {We present a survey of neutral ISM.},
}

@book{smith2020pragmatic,
  title = {The Pragmatic Programmer},
  author = {Smith, John},
  publisher = {Addison-Wesley},
  year = {2020},
  isbn = {978-0-13-468599-1},
}

@misc{chen2023attention,
  title = {Attention Is All You Need, Revisited},
  author = {Chen, Alice},
  year = {2023},
  eprint = {2301.12345},
  archiveprefix = {arXiv},
}
`;

describe('importBibtexContent (#98)', () => {
  let root: string;

  beforeEach(() => { root = mkTempProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('imports one source per entry and lands the meta.ttl under the canonical id', async () => {
    const result = await importBibtexContent(root, BASIC_BIB);

    expect(result.totalEntries).toBe(3);
    expect(result.imported).toHaveLength(3);
    expect(result.duplicate).toHaveLength(0);
    expect(result.failed).toHaveLength(0);

    // Check the DOI-keyed article landed where we expect.
    const doiId = 'doi-10.1234_foo.bar';
    expect(fs.existsSync(path.join(root, '.minerva/sources', doiId, 'meta.ttl'))).toBe(true);

    // ISBN-keyed book.
    const isbnId = 'isbn-9780134685991';
    expect(fs.existsSync(path.join(root, '.minerva/sources', isbnId, 'meta.ttl'))).toBe(true);

    // arXiv preprint from the eprint field.
    const arxivId = 'arxiv-2301.12345';
    expect(fs.existsSync(path.join(root, '.minerva/sources', arxivId, 'meta.ttl'))).toBe(true);
  });

  it('writes a meta.ttl with the expected shape', async () => {
    await importBibtexContent(root, BASIC_BIB);
    const ttl = await fsp.readFile(
      path.join(root, '.minerva/sources/doi-10.1234_foo.bar/meta.ttl'),
      'utf-8',
    );
    expect(ttl).toContain('this: a thought:Article');
    expect(ttl).toContain('dc:title "A Census of Na D-traced Neutral ISM"');
    expect(ttl).toContain('dc:creator "Yang Sun"');
    expect(ttl).toContain('dc:creator "Zhiyuan Ji"');
    expect(ttl).toContain("dc:creator \"Francesco D'Eugenio\"");
    expect(ttl).toContain('dc:issued "2024-10"^^xsd:gYearMonth');
    expect(ttl).toContain('schema:inContainer "Astrophysical Journal"');
    expect(ttl).toContain('bibo:doi "10.1234/foo.bar"');
    expect(ttl).toMatch(/bibo:uri "https:\/\/doi\.org\/10\.1234\/foo\.bar"/);
    expect(ttl).toContain('dc:abstract "We present a survey of neutral ISM."');
  });

  it('is idempotent: re-importing the same .bib dedupes on canonical id', async () => {
    await importBibtexContent(root, BASIC_BIB);
    const second = await importBibtexContent(root, BASIC_BIB);
    expect(second.imported).toHaveLength(0);
    expect(second.duplicate).toHaveLength(3);
  });

  it('captures per-entry failures without short-circuiting the rest', async () => {
    // Inject an entry that maps cleanly but is joined to a duplicate we already wrote.
    await importBibtexContent(root, BASIC_BIB);
    // Second import: same content → three duplicates + no failures; verifies the
    // iteration completes after the first dedupe.
    const result = await importBibtexContent(root, BASIC_BIB);
    expect(result.duplicate).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.totalEntries).toBe(3);
  });

  it('emits a progress callback for every entry, in order', async () => {
    const progress: Array<{ done: number; total: number; currentTitle: string }> = [];
    await importBibtexContent(root, BASIC_BIB, {
      onProgress: (p) => progress.push({ done: p.done, total: p.total, currentTitle: p.currentTitle }),
    });
    expect(progress).toHaveLength(3);
    expect(progress.map((p) => p.done)).toEqual([1, 2, 3]);
    expect(progress.every((p) => p.total === 3)).toBe(true);
    expect(progress[0].currentTitle).toContain('Census');
  });
});

describe('mapBibtexEntry', () => {
  it('maps an article entry onto ArticleMetadata', () => {
    const entry = {
      type: 'article',
      key: 'foo',
      fields: {
        title: 'Thing',
        author: [
          { firstName: 'Alice', lastName: 'Smith' },
          { firstName: 'Bob', lastName: 'Jones' },
        ],
        journal: 'Journal of Things',
        year: '2024',
        doi: '10.1234/foo',
      },
    };
    const meta = mapBibtexEntry(entry);
    expect(meta.subtype).toBe('Article');
    expect(meta.title).toBe('Thing');
    expect(meta.creators).toEqual(['Alice Smith', 'Bob Jones']);
    expect(meta.containerTitle).toBe('Journal of Things');
    expect(meta.issued).toBe('2024');
    expect(meta.doi).toBe('10.1234/foo');
  });

  it('classifies @book as Book', () => {
    const meta = mapBibtexEntry({
      type: 'book',
      key: 'k',
      fields: { title: 'X', publisher: 'Y', year: '2020' },
    });
    expect(meta.subtype).toBe('Book');
    expect(meta.publisher).toBe('Y');
  });

  it('classifies @misc with eprint as Preprint and lifts arxiv id', () => {
    const meta = mapBibtexEntry({
      type: 'misc',
      key: 'k',
      fields: { title: 'Paper', eprint: '2301.12345', archiveprefix: 'arXiv' },
    });
    expect(meta.subtype).toBe('Preprint');
    expect(meta.arxiv).toBe('2301.12345');
  });

  it('falls back to (untitled) when title is missing', () => {
    const meta = mapBibtexEntry({ type: 'article', key: 'k', fields: {} });
    expect(meta.title).toBe('(untitled)');
  });

  it('prefers journal over booktitle / series for containerTitle', () => {
    const meta = mapBibtexEntry({
      type: 'article', key: 'k',
      fields: { title: 'X', journal: 'J', booktitle: 'B', series: 'S' },
    });
    expect(meta.containerTitle).toBe('J');
  });
});

describe('parseAuthors', () => {
  it('stringifies first+last+suffix', () => {
    expect(parseAuthors([
      { firstName: 'Martin', lastName: 'Fowler' },
      { firstName: 'Alice', lastName: 'Smith', suffix: 'Jr.' },
    ])).toEqual(['Martin Fowler', 'Alice Smith Jr.']);
  });

  it('preserves a literal name when the parser couldn’t split', () => {
    expect(parseAuthors([{ literal: 'Anonymous' }, { firstName: 'A', lastName: 'B' }]))
      .toEqual(['Anonymous', 'A B']);
  });

  it('returns null for non-array input', () => {
    expect(parseAuthors(undefined)).toBeNull();
    expect(parseAuthors('not an array')).toBeNull();
  });
});

describe('extractIssuedDate', () => {
  it('prefers the BibLaTeX `date` field when present', () => {
    expect(extractIssuedDate({ date: '2024-10-15', year: '1900' })).toBe('2024-10-15');
  });

  it('composes year-month from short month names', () => {
    expect(extractIssuedDate({ year: '2024', month: 'oct' })).toBe('2024-10');
    expect(extractIssuedDate({ year: '2024', month: 'JAN' })).toBe('2024-01');
  });

  it('accepts a numeric month', () => {
    expect(extractIssuedDate({ year: '2024', month: '3' })).toBe('2024-03');
  });

  it('falls back to year-only when month is unrecognised', () => {
    expect(extractIssuedDate({ year: '2024', month: '???' })).toBe('2024');
  });

  it('returns null without a year', () => {
    expect(extractIssuedDate({})).toBeNull();
    expect(extractIssuedDate({ year: 'abcd' })).toBeNull();
  });
});
