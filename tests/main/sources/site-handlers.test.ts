import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  extractStructured,
  citationMetaHandler,
  arxivUrlHandler,
  pubmedUrlHandler,
  structuredToArticleMetadata,
  normalizeCitationDate,
  type DocLike,
} from '../../../src/main/sources/site-handlers';

function docFrom(html: string): DocLike {
  return parseHTML(html).document;
}

describe('citationMetaHandler (#221)', () => {
  it('pulls title, authors, DOI, arXiv id, journal, and date from Scholar-style meta tags', () => {
    const doc = docFrom(`<html><head>
      <meta name="citation_title" content="A Census of Na D-traced Neutral ISM">
      <meta name="citation_author" content="Sun, Yang">
      <meta name="citation_author" content="Ji, Zhiyuan">
      <meta name="citation_author" content="D'Eugenio, Francesco">
      <meta name="citation_doi" content="10.1234/foo.bar">
      <meta name="citation_arxiv_id" content="2604.18561">
      <meta name="citation_journal_title" content="Astrophysical Journal">
      <meta name="citation_publication_date" content="2024/10/15">
      <meta name="citation_publisher" content="IEEE">
      <meta name="citation_pdf_url" content="https://example.org/paper.pdf">
    </head></html>`);
    const out = citationMetaHandler(doc, new URL('https://example.org/paper'));
    expect(out).not.toBeNull();
    expect(out!.title).toBe('A Census of Na D-traced Neutral ISM');
    expect(out!.creators).toEqual(['Sun, Yang', 'Ji, Zhiyuan', "D'Eugenio, Francesco"]);
    expect(out!.doi).toBe('10.1234/foo.bar');
    expect(out!.arxiv).toBe('2604.18561');
    expect(out!.containerTitle).toBe('Astrophysical Journal');
    expect(out!.issued).toBe('2024-10-15');
    expect(out!.publisher).toBe('IEEE');
    expect(out!.pdfUrl).toBe('https://example.org/paper.pdf');
    expect(out!.subtype).toBe('Preprint'); // arxiv wins over journal for subtype
  });

  it('splits a single semicolon-joined citation_author field', () => {
    const doc = docFrom(`<html><head>
      <meta name="citation_title" content="X">
      <meta name="citation_author" content="Smith, J; Jones, A; Brown, B">
    </head></html>`);
    const out = citationMetaHandler(doc, new URL('https://ex.org/'));
    expect(out!.creators).toEqual(['Smith, J', 'Jones, A', 'Brown, B']);
  });

  it('returns null when no citation_title is present', () => {
    const doc = docFrom('<html><head><meta name="description" content="hi"></head></html>');
    expect(citationMetaHandler(doc, new URL('https://ex.org/'))).toBeNull();
  });

  it('infers Article subtype from a journal tag (no arXiv id)', () => {
    const doc = docFrom(`<html><head>
      <meta name="citation_title" content="T">
      <meta name="citation_author" content="A B">
      <meta name="citation_journal_title" content="J">
    </head></html>`);
    expect(citationMetaHandler(doc, new URL('https://ex.org/'))!.subtype).toBe('Article');
  });

  it('strips DOI URL prefix and lowercases', () => {
    const doc = docFrom(`<html><head>
      <meta name="citation_title" content="T">
      <meta name="citation_doi" content="https://doi.org/10.1109/MC.1987.1663532">
    </head></html>`);
    expect(citationMetaHandler(doc, new URL('https://ex.org/'))!.doi).toBe('10.1109/mc.1987.1663532');
  });

  it('strips `arXiv:` prefix and version suffix on arxiv ids', () => {
    const doc = docFrom(`<html><head>
      <meta name="citation_title" content="T">
      <meta name="citation_arxiv_id" content="arXiv:2604.18561v2">
    </head></html>`);
    expect(citationMetaHandler(doc, new URL('https://ex.org/'))!.arxiv).toBe('2604.18561');
  });
});

describe('arxivUrlHandler', () => {
  it('extracts the new-style id from /abs/ URLs', () => {
    expect(arxivUrlHandler(docFrom(''), new URL('https://arxiv.org/abs/2604.18561'))!.arxiv)
      .toBe('2604.18561');
  });

  it('extracts past a version suffix', () => {
    expect(arxivUrlHandler(docFrom(''), new URL('https://arxiv.org/abs/2604.18561v3'))!.arxiv)
      .toBe('2604.18561');
  });

  it('extracts from /pdf/ URLs with or without .pdf', () => {
    expect(arxivUrlHandler(docFrom(''), new URL('https://arxiv.org/pdf/2604.18561.pdf'))!.arxiv)
      .toBe('2604.18561');
    expect(arxivUrlHandler(docFrom(''), new URL('https://arxiv.org/pdf/2604.18561'))!.arxiv)
      .toBe('2604.18561');
  });

  it('returns null for non-arxiv hosts', () => {
    expect(arxivUrlHandler(docFrom(''), new URL('https://example.org/abs/2604.18561'))).toBeNull();
  });

  it('returns null when the URL doesn’t match the /abs/ or /pdf/ pattern', () => {
    expect(arxivUrlHandler(docFrom(''), new URL('https://arxiv.org/help/find'))).toBeNull();
  });
});

describe('pubmedUrlHandler', () => {
  it('extracts the PMID from pubmed URLs', () => {
    expect(pubmedUrlHandler(docFrom(''), new URL('https://pubmed.ncbi.nlm.nih.gov/12345678/'))!.pubmed)
      .toBe('12345678');
  });

  it('returns null for non-pubmed hosts', () => {
    expect(pubmedUrlHandler(docFrom(''), new URL('https://example.org/pubmed/12345'))).toBeNull();
  });
});

describe('extractStructured', () => {
  it('merges handler outputs — meta tags win but URL fallback fills gaps', () => {
    // Only an arxiv id is recoverable from the URL, but the page also
    // has meta-tag title and authors; merged result should have all three.
    const doc = docFrom(`<html><head>
      <meta name="citation_title" content="Paper">
      <meta name="citation_author" content="Author One">
    </head></html>`);
    const out = extractStructured(doc, new URL('https://arxiv.org/abs/2604.18561'));
    expect(out).not.toBeNull();
    expect(out!.title).toBe('Paper');
    expect(out!.creators).toEqual(['Author One']);
    expect(out!.arxiv).toBe('2604.18561'); // from URL handler, citation meta had none
    expect(out!.subtype).toBe('Preprint');
  });

  it('returns null when no handler found anything', () => {
    const doc = docFrom('<html><head><title>Plain page</title></head></html>');
    expect(extractStructured(doc, new URL('https://example.org/blog/post'))).toBeNull();
  });
});

describe('structuredToArticleMetadata', () => {
  it('uses handler fields with Readability fallbacks for the rest', () => {
    const meta = structuredToArticleMetadata(
      {
        title: 'Real Title',
        creators: ['Alice Smith'],
        doi: '10.1234/foo',
        subtype: 'Article',
      },
      {
        title: 'Readability Title',
        byline: 'Wrong Byline',
        abstract: 'Summary',
        issued: '2024',
        publisher: 'Publisher Inc',
        uri: 'https://example.org/paper',
      },
    );
    expect(meta.title).toBe('Real Title');
    expect(meta.creators).toEqual(['Alice Smith']); // not the byline
    expect(meta.doi).toBe('10.1234/foo');
    expect(meta.abstract).toBe('Summary'); // fallback filled this
    expect(meta.issued).toBe('2024');
    expect(meta.publisher).toBe('Publisher Inc');
    expect(meta.uri).toBe('https://example.org/paper');
    expect(meta.subtype).toBe('Article');
  });

  it('falls back to the Readability byline when the handler has no creators', () => {
    const meta = structuredToArticleMetadata(
      { doi: '10.1234/foo' },
      { title: 'T', byline: 'Bob B', uri: 'https://ex.org/' },
    );
    expect(meta.creators).toEqual(['Bob B']);
  });

  it('infers Preprint subtype from an arxiv id when handler didn’t set one', () => {
    const meta = structuredToArticleMetadata(
      { arxiv: '2604.18561' },
      { title: 'T', uri: 'https://arxiv.org/abs/2604.18561' },
    );
    expect(meta.subtype).toBe('Preprint');
  });

  it('infers Article when only a journal / DOI is known', () => {
    expect(structuredToArticleMetadata(
      { doi: '10.1/f', containerTitle: 'J' },
      { title: 'T', uri: 'u' },
    ).subtype).toBe('Article');
  });

  it('defaults to Source when nothing else is informative', () => {
    expect(structuredToArticleMetadata({}, { title: 'T', uri: 'u' }).subtype).toBe('Source');
  });
});

describe('normalizeCitationDate', () => {
  it('passes ISO shapes through', () => {
    expect(normalizeCitationDate('2024-10-15')).toBe('2024-10-15');
    expect(normalizeCitationDate('2024-10')).toBe('2024-10');
    expect(normalizeCitationDate('2024')).toBe('2024');
  });

  it('converts Google-Scholar-style slashes', () => {
    expect(normalizeCitationDate('2024/10/15')).toBe('2024-10-15');
    expect(normalizeCitationDate('2024/10')).toBe('2024-10');
    expect(normalizeCitationDate('2024/1/5')).toBe('2024-01-05');
  });

  it('falls back to the first 4-digit run', () => {
    expect(normalizeCitationDate('October 15, 2024')).toBe('2024');
  });

  it('returns null for unparseable inputs', () => {
    expect(normalizeCitationDate('')).toBeNull();
    expect(normalizeCitationDate('no year')).toBeNull();
  });
});
