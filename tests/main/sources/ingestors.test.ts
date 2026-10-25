/**
 * The ingestor registry and its one dispatch path (#2629): a file goes to the
 * ingestor registered for its extension; text goes to an identifier kind,
 * then the web ingestor, then a DOI found in prose; anything else is refused
 * with a message built from what's registered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  ingestIdentifier: vi.fn(),
  ingestUrl: vi.fn(),
  ingestPdfFile: vi.fn(),
  ingestHtmlFile: vi.fn(),
  ingestTextFile: vi.fn(),
}));
vi.mock('../../../src/main/sources/ingest-identifier', () => ({ ingestIdentifier: h.ingestIdentifier }));
vi.mock('../../../src/main/sources/ingest', () => ({ ingestUrl: h.ingestUrl }));
vi.mock('../../../src/main/sources/ingest-file-types', () => ({
  ingestPdfFile: h.ingestPdfFile, ingestHtmlFile: h.ingestHtmlFile, ingestTextFile: h.ingestTextFile,
}));

import { INGESTORS, hostMatches, ingestSource, ingestibleFileExtensions, setExtraIngestors } from '../../../src/main/sources/ingestors';
import { IDENTIFIER_KINDS } from '../../../src/main/sources/identifier-kinds';

const made = { sourceId: 's', relativePath: '.minerva/sources/s/meta.ttl', duplicate: false, title: 'T' };

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [h.ingestPdfFile, h.ingestHtmlFile, h.ingestTextFile, h.ingestUrl]) fn.mockResolvedValue({ ...made, kind: 'x' });
  h.ingestIdentifier.mockResolvedValue({ ...made, kind: 'doi', pdfSaved: false, pdfError: null });
});

describe('the registry', () => {
  it('has unique ids, and an ingestor for every identifier kind', () => {
    const ids = INGESTORS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of IDENTIFIER_KINDS) {
      expect(INGESTORS.some((i) => 'identifier' in i.accepts && i.accepts.identifier === k.kind), k.kind).toBe(true);
    }
  });

  it('gives the Ingest File dialog every registered extension', () => {
    expect(ingestibleFileExtensions().sort()).toEqual(['htm', 'html', 'markdown', 'md', 'pdf', 'text', 'txt']);
  });
});

describe('ingestSource — a file', () => {
  it.each([
    ['/x/Paper.PDF', 'ingestPdfFile'],
    ['/x/page.htm', 'ingestHtmlFile'],
    ['/x/notes.md', 'ingestTextFile'],
    ['/x/notes.txt', 'ingestTextFile'],
  ] as const)('%s goes to %s', async (p, fn) => {
    const r = await ingestSource('/root', { kind: 'file', path: p });
    expect(h[fn]).toHaveBeenCalledWith('/root', p);
    expect(r.route).toBe('file');
  });

  it('refuses an unregistered type, naming what is supported', async () => {
    await expect(ingestSource('/root', { kind: 'file', path: '/x/a.docx' }))
      .rejects.toThrow("Can't ingest *.docx as a source yet — PDF, HTML, text, and Markdown are supported.");
    await expect(ingestSource('/root', { kind: 'file', path: '/x/README' }))
      .rejects.toThrow("Can't ingest * (no extension) as a source yet");
  });
});

describe('ingestSource — text', () => {
  it('an identifier, or an identifier-bearing URL, goes to the identifier ingestor before any page fetch', async () => {
    await ingestSource('/root', { kind: 'text', text: '  10.1038/s41586-023-06924-6  ' });
    await ingestSource('/root', { kind: 'text', text: 'https://doi.org/10.1038/s41586-023-06924-6' });
    expect(h.ingestIdentifier).toHaveBeenCalledTimes(2);
    expect(h.ingestIdentifier.mock.calls[0]![1]).toBe('10.1038/s41586-023-06924-6');
    expect(h.ingestUrl).not.toHaveBeenCalled();
  });

  it('any other URL goes to the web ingestor', async () => {
    const r = await ingestSource('/root', { kind: 'text', text: 'https://example.org/post' });
    expect(h.ingestUrl).toHaveBeenCalledWith('/root', 'https://example.org/post', {});
    expect(r.route).toBe('url');
  });

  it('prose with a DOI in it ingests the DOI, end-of-sentence punctuation trimmed', async () => {
    await ingestSource('/root', { kind: 'text', text: 'see 10.1145/3442188.3445922. for context' });
    expect(h.ingestIdentifier).toHaveBeenCalledWith('/root', '10.1145/3442188.3445922', {});
  });

  it('refuses empty and unrecognised text', async () => {
    await expect(ingestSource('/root', { kind: 'text', text: '   ' })).rejects.toThrow('Empty input.');
    await expect(ingestSource('/root', { kind: 'text', text: 'just some words' }))
      .rejects.toThrow('Not a recognised URL, DOI, arXiv id, or PubMed id: just some words');
  });
});

describe('ingestors from outside the source (#2647)', () => {
  const ingest = vi.fn();
  const SRT = { id: 'plugin:transcripts/transcript', label: 'Transcript', accepts: { extensions: ['.srt', '.vtt'] }, ingest };
  beforeEach(() => ingest.mockResolvedValue({ ...made, route: 'file' }));
  afterEach(() => setExtraIngestors(null));

  it('joins the file dialog and the dispatch, and goes when its provider drops it', async () => {
    setExtraIngestors(() => [SRT]);
    expect(ingestibleFileExtensions()).toEqual(expect.arrayContaining(['srt', 'vtt', 'pdf']));
    await ingestSource('/root', { kind: 'file', path: '/x/Talk.VTT' });
    expect(ingest).toHaveBeenCalledWith('/root', '/x/Talk.VTT', {});
    setExtraIngestors(() => []);
    expect(ingestibleFileExtensions()).not.toContain('srt');
    await expect(ingestSource('/root', { kind: 'file', path: '/x/a.srt' })).rejects.toThrow("Can't ingest *.srt");
  });

  it('never takes an extension a built-in reads', async () => {
    setExtraIngestors(() => [{ ...SRT, accepts: { extensions: ['.pdf'] } }]);
    await ingestSource('/root', { kind: 'file', path: '/x/a.pdf' });
    expect(h.ingestPdfFile).toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('a plugin\'s sites and identifiers (#2880)', () => {
  const site = vi.fn();
  const prefix = vi.fn();
  beforeEach(() => {
    site.mockReset().mockResolvedValue({ ...made, route: 'url' });
    prefix.mockReset().mockResolvedValue({ ...made, route: 'url' });
    setExtraIngestors(() => [
      { id: 'plugin:shelf/page', label: 'Book page', accepts: { urlHosts: ['*.books.example'] }, ingest: site },
      { id: 'plugin:shelf/id', label: 'Shelf id', accepts: { identifierPrefixes: ['shelf:'] }, ingest: prefix },
    ]);
  });
  afterEach(() => setExtraIngestors(null));

  it('a page on its host goes to the plugin, ahead of the web ingestor', async () => {
    await ingestSource('/root', { kind: 'text', text: 'https://www.books.example/books/1' });
    await ingestSource('/root', { kind: 'text', text: 'https://books.example/books/2' });
    expect(site.mock.calls.map((c) => c[1])).toEqual(['https://www.books.example/books/1', 'https://books.example/books/2']);
    expect(h.ingestUrl).not.toHaveBeenCalled();
    await ingestSource('/root', { kind: 'text', text: 'https://notbooks.example/books/3' });
    expect(h.ingestUrl).toHaveBeenCalledWith('/root', 'https://notbooks.example/books/3', {});
  });

  it('a prefix goes to the plugin in any case, and an identifier is still Minerva\'s first', async () => {
    await ingestSource('/root', { kind: 'text', text: 'Shelf:9' });
    expect(prefix).toHaveBeenCalledWith('/root', 'Shelf:9', {});
    await ingestSource('/root', { kind: 'text', text: 'https://doi.org/10.1038/nature12373' });
    expect(h.ingestIdentifier).toHaveBeenCalled();
    expect(site).not.toHaveBeenCalled();
  });

  it('hostMatches: exact, or a wildcard for the domain and its subdomains, never a suffix of another name', () => {
    expect(hostMatches('books.example', 'BOOKS.example.')).toBe(true);
    expect(hostMatches('books.example', 'www.books.example')).toBe(false);
    expect(hostMatches('*.books.example', 'a.b.books.example')).toBe(true);
    expect(hostMatches('*.books.example', 'books.example')).toBe(true);
    expect(hostMatches('*.books.example', 'evilbooks.example')).toBe(false);
  });
});
