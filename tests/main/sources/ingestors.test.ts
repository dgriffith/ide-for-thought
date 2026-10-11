/**
 * The ingestor registry and its one dispatch path (#2629): a file goes to the
 * ingestor registered for its extension; text goes to an identifier kind,
 * then the web ingestor, then a DOI found in prose; anything else is refused
 * with a message built from what's registered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { INGESTORS, ingestSource, ingestibleFileExtensions } from '../../../src/main/sources/ingestors';
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
