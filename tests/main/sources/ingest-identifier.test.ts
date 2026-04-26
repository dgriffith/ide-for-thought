import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  detectIdentifier,
  ingestIdentifier,
  buildMetaTtl,
} from '../../../src/main/sources/ingest-identifier';
import type { ArticleMetadata } from '../../../src/main/sources/api-adapters/types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ident-test-'));
}

describe('detectIdentifier (#96)', () => {
  it('recognises a bare DOI', () => {
    expect(detectIdentifier('10.1038/s41586-023-06924-6')).toEqual({
      kind: 'doi',
      value: '10.1038/s41586-023-06924-6',
    });
  });

  it('recognises a DOI with a URL prefix', () => {
    expect(detectIdentifier('https://doi.org/10.1038/x')?.kind).toBe('doi');
  });

  it('recognises a modern arXiv id', () => {
    expect(detectIdentifier('2301.12345')).toEqual({ kind: 'arxiv', value: '2301.12345' });
  });

  it('recognises an arXiv id with version suffix and prefix', () => {
    expect(detectIdentifier('arXiv:2301.12345v3')).toEqual({
      kind: 'arxiv',
      value: '2301.12345',
    });
  });

  it('recognises a PubMed id', () => {
    expect(detectIdentifier('12345678')).toEqual({ kind: 'pubmed', value: '12345678' });
  });

  it('recognises a PubMed id with `PMID:` prefix', () => {
    expect(detectIdentifier('PMID: 12345678')).toEqual({ kind: 'pubmed', value: '12345678' });
  });

  it('returns null for unrecognisable input', () => {
    expect(detectIdentifier('just some text')).toBeNull();
    expect(detectIdentifier('')).toBeNull();
  });
});

describe('buildMetaTtl (#96)', () => {
  const base: ArticleMetadata = {
    subtype: 'Article',
    title: 'The Paper',
    creators: ['Alice Smith', 'Bob Jones'],
    abstract: 'The abstract.',
    issued: '2024-01-15',
    publisher: 'Nature Publishing Group',
    containerTitle: 'Nature',
    doi: '10.1038/x',
    isbn: null,
    arxiv: null,
    pubmed: null,
    uri: 'https://doi.org/10.1038/x',
    pdfUrl: null,
    category: null,
  };

  it('emits every populated predicate and declares the subtype', () => {
    const ttl = buildMetaTtl(base);
    expect(ttl).toContain('this: a thought:Article');
    expect(ttl).toContain('dc:title "The Paper"');
    expect(ttl).toContain('dc:creator "Alice Smith"');
    expect(ttl).toContain('dc:creator "Bob Jones"');
    expect(ttl).toContain('dc:issued "2024-01-15"^^xsd:date');
    expect(ttl).toContain('dc:publisher "Nature Publishing Group"');
    expect(ttl).toContain('schema:inContainer "Nature"');
    expect(ttl).toContain('bibo:doi "10.1038/x"');
    expect(ttl).toContain('bibo:uri "https://doi.org/10.1038/x"');
    expect(ttl).toContain('dc:abstract "The abstract."');
    expect(ttl).toMatch(/thought:accessedAt "[^"]+"\^\^xsd:dateTime \./);
  });

  it('picks the right xsd datatype for partial dates', () => {
    expect(buildMetaTtl({ ...base, issued: '2024' })).toContain('"2024"^^xsd:gYear');
    expect(buildMetaTtl({ ...base, issued: '2024-06' })).toContain('"2024-06"^^xsd:gYearMonth');
  });

  it('omits optional predicates when data is missing', () => {
    const ttl = buildMetaTtl({
      ...base,
      creators: [],
      issued: null,
      publisher: null,
      containerTitle: null,
      isbn: null,
      abstract: null,
    });
    expect(ttl).not.toContain('dc:creator');
    expect(ttl).not.toContain('dc:issued');
    expect(ttl).not.toContain('dc:publisher');
    expect(ttl).not.toContain('schema:inContainer');
    expect(ttl).not.toContain('dc:abstract');
  });

  it('escapes special characters in literals', () => {
    const ttl = buildMetaTtl({ ...base, title: 'Title with "quotes" and \\slash' });
    expect(ttl).toContain('dc:title "Title with \\"quotes\\" and \\\\slash"');
  });
});

describe('ingestIdentifier (#96)', () => {
  let root: string;

  beforeEach(() => { root = mkTempProject(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function mockFetchForDoi(): typeof fetch {
    return async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.crossref.org/works/')) {
        return new Response(JSON.stringify({
          message: {
            DOI: '10.1038/test',
            type: 'journal-article',
            title: ['A Test Paper'],
            author: [{ given: 'Alice', family: 'Smith' }],
            issued: { 'date-parts': [[2024, 5, 10]] },
            'container-title': ['Nature'],
            publisher: 'Springer Nature',
            abstract: '<jats:p>Abstract here.</jats:p>',
            URL: 'https://doi.org/10.1038/test',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    };
  }

  it('writes meta.ttl and body.md for a DOI ingest', async () => {
    const result = await ingestIdentifier(root, '10.1038/test', { fetchImpl: mockFetchForDoi() });
    expect(result.duplicate).toBe(false);
    expect(result.title).toBe('A Test Paper');
    expect(result.kind).toBe('doi');
    expect(result.sourceId).toBe('doi-10.1038_test');

    const dir = path.join(root, '.minerva', 'sources', result.sourceId);
    expect(fs.existsSync(path.join(dir, 'meta.ttl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'body.md'))).toBe(true);

    const ttl = await fsp.readFile(path.join(dir, 'meta.ttl'), 'utf-8');
    expect(ttl).toContain('this: a thought:Article');
    expect(ttl).toContain('dc:creator "Alice Smith"');

    const body = await fsp.readFile(path.join(dir, 'body.md'), 'utf-8');
    expect(body).toMatch(/^# A Test Paper\n\nAbstract here\./);
  });

  it('returns duplicate=true on second ingest of the same identifier', async () => {
    await ingestIdentifier(root, '10.1038/test', { fetchImpl: mockFetchForDoi() });
    const second = await ingestIdentifier(root, '10.1038/test', { fetchImpl: mockFetchForDoi() });
    expect(second.duplicate).toBe(true);
    expect(second.title).toBe('A Test Paper');
  });

  it('also dedupes across DOI URL wrappings (`https://doi.org/...`)', async () => {
    await ingestIdentifier(root, '10.1038/test', { fetchImpl: mockFetchForDoi() });
    const second = await ingestIdentifier(root, 'https://doi.org/10.1038/test', { fetchImpl: mockFetchForDoi() });
    expect(second.duplicate).toBe(true);
  });

  it('rejects unrecognisable input', async () => {
    await expect(ingestIdentifier(root, 'not-an-id', {
      fetchImpl: (async () => new Response('')) as unknown as typeof fetch,
    })).rejects.toThrow(/not a recognised/i);
  });

  it('handles CrossRef 404 gracefully', async () => {
    const badFetch = (async () =>
      new Response('', { status: 404, statusText: 'Not Found' })
    ) as unknown as typeof fetch;
    await expect(
      ingestIdentifier(root, '10.1038/nonexistent', { fetchImpl: badFetch }),
    ).rejects.toThrow(/404/);
  });

  it('still creates the source when the advertised PDF fetch fails', async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.crossref.org')) {
        return new Response(JSON.stringify({
          message: {
            DOI: '10.1038/pdffail',
            type: 'journal-article',
            title: ['Paper with Broken PDF'],
            author: [],
            link: [{ URL: 'https://example.com/paywall.pdf', 'content-type': 'application/pdf' }],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // Simulate a 403 paywall on the PDF endpoint.
      return new Response('', { status: 403, statusText: 'Forbidden' });
    };

    const result = await ingestIdentifier(root, '10.1038/pdffail', { fetchImpl });
    expect(result.duplicate).toBe(false);
    expect(result.pdfSaved).toBe(false);
    expect(result.pdfError).toMatch(/403/);
    const dir = path.join(root, '.minerva', 'sources', result.sourceId);
    expect(fs.existsSync(path.join(dir, 'meta.ttl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'original.pdf'))).toBe(false);
  });

  it('saves the PDF when the fetch succeeds', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.crossref.org')) {
        return new Response(JSON.stringify({
          message: {
            DOI: '10.1038/pdfok',
            type: 'journal-article',
            title: ['Paper with OA PDF'],
            author: [{ given: 'X', family: 'Y' }],
            link: [{ URL: 'https://example.com/ok.pdf', 'content-type': 'application/pdf' }],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    };

    const result = await ingestIdentifier(root, '10.1038/pdfok', { fetchImpl });
    expect(result.pdfSaved).toBe(true);
    expect(result.pdfError).toBeNull();
    const dir = path.join(root, '.minerva', 'sources', result.sourceId);
    expect(fs.existsSync(path.join(dir, 'original.pdf'))).toBe(true);
  });
});
