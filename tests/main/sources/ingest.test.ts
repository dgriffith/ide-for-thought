import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  ingestUrl,
  extractReadable,
  buildBodyMarkdown,
  buildMetaTtl,
} from '../../../src/main/sources/ingest';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ingest-test-'));
}

function samplePageHtml(overrides: Partial<{
  title: string;
  byline: string;
  siteName: string;
  body: string;
}> = {}): string {
  const {
    title = 'A Reasonable Headline',
    byline = 'Jane Doe',
    siteName = 'Example News',
    body = '<p>This is the lede paragraph, which should be long enough for Readability to recognise it as content. Readability heuristically scores each paragraph for word count, link density, and punctuation, so we need a bit of prose here to beat the threshold.</p><p>A second paragraph adds more weight so the article score clears the extraction bar. Without this, Readability tends to return null for very short pages.</p><p>A third for good measure — Readability is fussy about sparse markup.</p>',
  } = overrides;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <meta property="og:site_name" content="${siteName}">
    <meta name="author" content="${byline}">
  </head>
  <body>
    <article>
      <h1>${title}</h1>
      ${body}
    </article>
  </body>
</html>`;
}

describe('extractReadable (#93)', () => {
  it('extracts title, byline, siteName, and content', () => {
    const article = extractReadable(samplePageHtml(), 'https://example.com/foo');
    expect(article.title).toBe('A Reasonable Headline');
    expect(article.byline).toBe('Jane Doe');
    expect(article.siteName).toBe('Example News');
    expect(article.contentHtml).toContain('lede paragraph');
  });

  it('tolerates missing byline and siteName', () => {
    const html = `<!doctype html><html><head><title>Bare Page</title></head><body><article><h1>Bare Page</h1><p>Some body content that is long enough for Readability to accept it as an article, even without the usual metadata surrounding markup.</p><p>Adding a second paragraph so the content passes the Readability threshold, which is stricter on short pages.</p></article></body></html>`;
    const article = extractReadable(html, 'https://example.com/bare');
    expect(article.title).toBe('Bare Page');
    expect(article.byline).toBeNull();
    expect(article.siteName).toBeNull();
  });

  it('throws when the page has no recognisable article content', () => {
    expect(() =>
      extractReadable('<!doctype html><html><body></body></html>', 'https://example.com'),
    ).toThrow();
  });
});

describe('buildBodyMarkdown (#93)', () => {
  it('emits an H1 of the title and the body as markdown', () => {
    const article = {
      title: 'My Title',
      byline: null,
      siteName: null,
      excerpt: null,
      publishedTime: null,
      lang: null,
      contentHtml: '<p>Hello <strong>world</strong>.</p>',
      textContent: 'Hello world.',
    };
    const md = buildBodyMarkdown(article);
    expect(md).toMatch(/^# My Title\n\n/);
    expect(md).toContain('Hello **world**.');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('falls back to textContent when contentHtml is empty', () => {
    const article = {
      title: 'Fallback',
      byline: null,
      siteName: null,
      excerpt: null,
      publishedTime: null,
      lang: null,
      contentHtml: '',
      textContent: 'Just plain text.',
    };
    expect(buildBodyMarkdown(article)).toContain('Just plain text.');
  });
});

describe('buildMetaTtl (#93)', () => {
  it('emits a well-formed WebPage record with the standard predicates', () => {
    const ttl = buildMetaTtl(
      {
        title: 'Title',
        byline: 'Author',
        siteName: 'Site',
        excerpt: 'Summary',
        publishedTime: '2025-01-01',
        lang: 'en',
        contentHtml: '',
        textContent: '',
      },
      'https://example.com/foo',
    );
    expect(ttl).toContain('this: a thought:WebPage');
    expect(ttl).toContain('dc:title "Title"');
    expect(ttl).toContain('bibo:uri "https://example.com/foo"');
    expect(ttl).toContain('dc:creator "Author"');
    expect(ttl).toContain('dc:publisher "Site"');
    expect(ttl).toContain('dc:abstract "Summary"');
    expect(ttl).toContain('dc:issued "2025-01-01"');
    expect(ttl).toContain('dc:language "en"');
    expect(ttl).toMatch(/thought:accessedAt "[^"]+"\^\^xsd:dateTime \./);
  });

  it('omits optional predicates when the metadata is absent', () => {
    const ttl = buildMetaTtl(
      {
        title: 'Title',
        byline: null,
        siteName: null,
        excerpt: null,
        publishedTime: null,
        lang: null,
        contentHtml: '',
        textContent: '',
      },
      'https://example.com/bare',
    );
    expect(ttl).not.toContain('dc:creator');
    expect(ttl).not.toContain('dc:publisher');
    expect(ttl).not.toContain('dc:abstract');
    expect(ttl).not.toContain('dc:issued');
    expect(ttl).not.toContain('dc:language');
  });

  it('escapes embedded quotes and backslashes in string literals', () => {
    const ttl = buildMetaTtl(
      {
        title: 'Title with "quotes" and \\ backslash',
        byline: null,
        siteName: null,
        excerpt: null,
        publishedTime: null,
        lang: null,
        contentHtml: '',
        textContent: '',
      },
      'https://example.com/',
    );
    expect(ttl).toContain('dc:title "Title with \\"quotes\\" and \\\\ backslash"');
  });
});

describe('ingestUrl (#93)', () => {
  let root: string;

  beforeEach(() => {
    root = mkTempProject();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function mockFetch(html: string, opts: { contentType?: string; status?: number } = {}): typeof fetch {
    return async () => {
      return new Response(html, {
        status: opts.status ?? 200,
        headers: { 'content-type': opts.contentType ?? 'text/html; charset=utf-8' },
      });
    };
  }

  it('writes original.html, body.md, and meta.ttl under sources/<id>/', async () => {
    const result = await ingestUrl(root, 'https://example.com/foo', {
      fetchImpl: mockFetch(samplePageHtml()),
    });
    expect(result.duplicate).toBe(false);
    expect(result.title).toBe('A Reasonable Headline');
    expect(result.sourceId).toMatch(/^url-[a-f0-9]{12}$/);
    expect(result.relativePath).toBe(`.minerva/sources/${result.sourceId}/meta.ttl`);

    const dir = path.join(root, '.minerva', 'sources', result.sourceId);
    expect(fs.existsSync(path.join(dir, 'original.html'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'body.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'meta.ttl'))).toBe(true);

    const body = await fsp.readFile(path.join(dir, 'body.md'), 'utf-8');
    expect(body).toMatch(/^# A Reasonable Headline/);
  });

  it('returns duplicate=true on a second ingest of the same normalised URL', async () => {
    await ingestUrl(root, 'https://example.com/foo', {
      fetchImpl: mockFetch(samplePageHtml()),
    });
    const second = await ingestUrl(root, 'https://example.com/foo/?utm_source=x', {
      // Different URL shape but same normalisation → same id → duplicate hit.
      fetchImpl: mockFetch(samplePageHtml({ title: 'Replaced' })),
    });
    expect(second.duplicate).toBe(true);
    expect(second.title).toBe('A Reasonable Headline');
  });

  it('does not overwrite existing files on duplicate', async () => {
    await ingestUrl(root, 'https://example.com/foo', {
      fetchImpl: mockFetch(samplePageHtml({ title: 'Original' })),
    });
    const sourceDir = path.join(root, '.minerva', 'sources');
    const ids = await fsp.readdir(sourceDir);
    const dir = path.join(sourceDir, ids[0]);
    await fsp.writeFile(path.join(dir, 'body.md'), '# Hand-edited\n\nkeep me.\n', 'utf-8');

    await ingestUrl(root, 'https://example.com/foo', {
      fetchImpl: mockFetch(samplePageHtml({ title: 'Replacement' })),
    });

    const body = await fsp.readFile(path.join(dir, 'body.md'), 'utf-8');
    expect(body).toContain('Hand-edited');
  });

  it('rejects a non-URL input', async () => {
    await expect(
      ingestUrl(root, 'not a url', { fetchImpl: mockFetch('') }),
    ).rejects.toThrow(/not a valid url/i);
  });

  it('propagates HTTP failures', async () => {
    await expect(
      ingestUrl(root, 'https://example.com/404', {
        fetchImpl: mockFetch('<html></html>', { status: 404 }),
      }),
    ).rejects.toThrow(/404/);
  });

  it('rejects non-HTML content types', async () => {
    await expect(
      ingestUrl(root, 'https://example.com/doc.pdf', {
        fetchImpl: mockFetch('%PDF-1.4...', { contentType: 'application/pdf' }),
      }),
    ).rejects.toThrow(/unsupported content-type/i);
  });

  it('uses the arXiv URL pattern to upgrade the canonical id past url-<hash> (#221)', async () => {
    const arxivHtml = samplePageHtml({
      title: 'On the Growth Rate of Trees',
      body: '<p>We prove a bound on tree growth rates. This paragraph is long enough for Readability to latch onto it as the article body, which needs a bit of prose to clear the heuristic bar.</p><p>A second paragraph keeps the word count comfortable.</p><p>And a third for safety.</p>',
    });
    const result = await ingestUrl(root, 'https://arxiv.org/abs/2604.18561', {
      fetchImpl: mockFetch(arxivHtml),
    });
    // The site handler picked up the arXiv id from the URL and routed the
    // source through the arxiv-<id> folder instead of url-<hash>.
    expect(result.sourceId).toBe('arxiv-2604.18561');
    const meta = await fsp.readFile(
      path.join(root, '.minerva/sources/arxiv-2604.18561/meta.ttl'),
      'utf-8',
    );
    expect(meta).toContain('thought:Preprint');
  });

  it('reads citation_* meta tags into multi-author meta.ttl (#221)', async () => {
    const html = `<!doctype html><html><head>
      <title>Publisher-generated page title</title>
      <meta name="citation_title" content="A Census of Na D-traced Neutral ISM">
      <meta name="citation_author" content="Sun, Yang">
      <meta name="citation_author" content="Ji, Zhiyuan">
      <meta name="citation_doi" content="10.1234/foo.bar">
      <meta name="citation_journal_title" content="Astrophysical Journal">
      <meta name="citation_publication_date" content="2024-10-15">
    </head><body>
      <article><h1>A Census of Na D-traced Neutral ISM</h1>
      <p>We present a large-scale survey of neutral interstellar medium (ISM) properties across galaxies at intermediate redshift. The dataset spans hundreds of targets observed with modern integral-field spectrographs, and the analysis recovers outflow velocities for a substantial fraction of the sample.</p>
      <p>This provides the first statistical census of ISM-traced outflows in this redshift range, with implications for feedback modelling in galaxy-formation simulations.</p>
      <p>We release the reduced data and a public catalogue of line measurements.</p>
      </article>
    </body></html>`;
    const result = await ingestUrl(root, 'https://example-journal.org/articles/foo', {
      fetchImpl: mockFetch(html),
    });
    // Upgraded to a DOI-based canonical id, with an Article-typed meta.ttl
    // carrying one dc:creator per author rather than a byline guess.
    expect(result.sourceId).toBe('doi-10.1234_foo.bar');
    const meta = await fsp.readFile(
      path.join(root, '.minerva/sources/doi-10.1234_foo.bar/meta.ttl'),
      'utf-8',
    );
    expect(meta).toContain('thought:Article');
    expect(meta).toContain('dc:title "A Census of Na D-traced Neutral ISM"');
    expect(meta).toContain('dc:creator "Sun, Yang"');
    expect(meta).toContain('dc:creator "Ji, Zhiyuan"');
    expect(meta).toContain('bibo:doi "10.1234/foo.bar"');
    expect(meta).toContain('schema:inContainer "Astrophysical Journal"');
    expect(meta).toContain('dc:issued "2024-10-15"^^xsd:date');
  });

  it('falls back to the Readability + WebPage flow when no site handler matches', async () => {
    const result = await ingestUrl(root, 'https://random-blog.example/post', {
      fetchImpl: mockFetch(samplePageHtml()),
    });
    expect(result.sourceId).toMatch(/^url-[a-f0-9]{12}$/);
    const meta = await fsp.readFile(
      path.join(root, '.minerva/sources', result.sourceId, 'meta.ttl'),
      'utf-8',
    );
    expect(meta).toContain('thought:WebPage');
  });
});
