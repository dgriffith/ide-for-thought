/**
 * URL ingestion (#93).
 *
 * Fetch a URL, run Mozilla Readability over the HTML, derive clean metadata
 * (title, byline, publication, excerpt), convert the readable body to
 * markdown, and persist the whole thing under `.minerva/sources/<id>/` as:
 *
 *   - `original.html` — the page's full HTML (for archive / re-extraction)
 *   - `body.md` — the Readability-extracted content as markdown
 *   - `meta.ttl` — a short Turtle file describing the WebPage source
 *
 * The source id comes from `canonicalSourceId` (#90), so re-ingesting the
 * same URL — regardless of trailing slashes, tracking params, `www.`, etc.
 * — hits the same folder. Duplicates return without overwriting, so the
 * user can spot and merge by hand if they want.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { canonicalSourceId, normalizeUrl } from './source-id';
import { mergeMetaTtl } from './source-merge';
import { extractStructured, structuredToArticleMetadata } from './site-handlers';
import { buildMetaTtl as buildArticleMetaTtl } from './ingest-identifier';
import { ingestPdfBuffer } from './ingest-pdf';

export interface IngestResult {
  sourceId: string;
  relativePath: string;
  /** True when the source already existed; no files were overwritten. */
  duplicate: boolean;
  /** The `<title>`-derived title, for the caller to surface in a toast. */
  title: string;
  /** What was ingested. `'web'` for an HTML page, `'pdf'` when a URL/file served
   *  a PDF (routed to the PDF pipeline), `'text'` for a plain-text/Markdown file.
   *  Absent on legacy callers that don't set it. */
  kind?: 'web' | 'pdf' | 'text';
  /** PDF page count — only set when `kind === 'pdf'`. */
  pageCount?: number;
  /** True when a PDF (from a URL) had no text layer and needs OCR — only set
   *  when `kind === 'pdf'`. The renderer runs the same OCR flow as a file PDF. */
  needsOcr?: boolean;
}

export interface IngestOptions {
  /** Dependency-injection seam for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** When false, page-derived subject tags (e.g. Amazon breadcrumb categories)
   *  are not written. Mirrors the identifier-ingest setting (#473). Default
   *  true. */
  importUpstreamTags?: boolean;
}

export async function ingestUrl(
  rootPath: string,
  rawUrl: string,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) throw new Error(`Not a valid URL: ${rawUrl}`);

  // A URL can resolve to HTML or to a PDF (e.g. an arXiv /pdf/ link). Fetch
  // once, then branch on the content: a PDF goes through the PDF pipeline so
  // "Ingest URL as Source" handles papers-by-link, not just web pages.
  const fetched = await fetchForIngest(normalized, opts.fetchImpl ?? globalThis.fetch);
  if (fetched.kind === 'pdf') {
    const pdf = await ingestPdfBuffer(rootPath, Buffer.from(fetched.bytes), {
      originalFilename: pdfFilenameFromUrl(normalized),
    });
    return {
      sourceId: pdf.sourceId,
      relativePath: pdf.relativePath,
      duplicate: pdf.duplicate,
      title: pdf.title,
      kind: 'pdf',
      pageCount: pdf.pageCount,
      needsOcr: pdf.needsOcr,
    };
  }
  return ingestHtmlString(rootPath, fetched.text, {
    url: normalized,
    importUpstreamTags: opts.importUpstreamTags,
  });
}

/**
 * Persist a web Source from an HTML string. Shared by URL ingest (with a `url`,
 * which enables site-handler structured metadata + a bibo:uri) and local-file
 * ingest (no `url` — id falls back to a content hash, no bibo:uri). Returns the
 * same shape as `ingestUrl`'s HTML path.
 */
export async function ingestHtmlString(
  rootPath: string,
  html: string,
  opts: { url?: string; titleFallback?: string; importUpstreamTags?: boolean } = {},
): Promise<IngestResult> {
  const url = opts.url ?? null;
  const { document } = parseHTML(html);
  if (url) {
    Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
    Object.defineProperty(document, 'baseURI', { value: url, configurable: true });
  }

  const structured = url ? extractStructured(document, new URL(url)) : null;
  // Honor the import-upstream-tags setting (#473): drop page-derived subject
  // tags before they reach meta.ttl when the user has opted out.
  if (structured && opts.importUpstreamTags === false) {
    structured.keywords = [];
  }

  const { id: sourceId } = canonicalSourceId(
    {
      doi: structured?.doi ?? undefined,
      arxiv: structured?.arxiv ?? undefined,
      pubmed: structured?.pubmed ?? undefined,
      isbn: structured?.isbn ?? undefined,
      url: url ?? undefined,
    },
    // No URL/identifier (local file) → seed the id off the content.
    url ? undefined : html,
  );
  const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
  const relativePath = `.minerva/sources/${sourceId}/meta.ttl`;

  const extracted = extractReadableFromDoc(document, url ?? '', opts.titleFallback);

  // Dedupe: if meta.ttl already exists, MERGE new metadata into it
  // rather than overwrite or skip (#90). body.md and other files are
  // left untouched so the user's hand edits there survive a re-ingest.
  try {
    const existingTtl = await fs.readFile(path.join(sourceDir, 'meta.ttl'), 'utf-8');
    const update: Parameters<typeof mergeMetaTtl>[1] = structured
      ? {
          doi: structured.doi ?? null,
          isbn: structured.isbn ?? null,
          uri: url,
          // Structured handlers may supply richer metadata — fold it in
          // via structuredToArticleMetadata so the field shapes line up.
          ...(() => {
            const m = structuredToArticleMetadata(structured, {
              title: extracted.title,
              byline: extracted.byline,
              abstract: extracted.excerpt,
              issued: extracted.publishedTime,
              publisher: extracted.siteName,
              uri: url,
            });
            return {
              issued: m.issued,
              publisher: m.publisher,
              containerTitle: m.containerTitle,
              abstract: m.abstract,
              creators: m.creators,
            };
          })(),
        }
      : {
          uri: url,
          publisher: extracted.siteName,
          abstract: extracted.excerpt,
          issued: extracted.publishedTime,
          creators: extracted.byline ? [extracted.byline] : null,
        };
    const { ttl: merged, added } = mergeMetaTtl(existingTtl, update);
    if (added.length > 0) {
      await fs.writeFile(path.join(sourceDir, 'meta.ttl'), merged, 'utf-8');
    }
    const existingTitle = await readExistingTitle(sourceDir).catch(() => '');
    return { sourceId, relativePath, duplicate: true, title: existingTitle || extracted.title, kind: 'web' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // Not found — proceed to fresh ingest.
  }

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'original.html'), html, 'utf-8');
  await fs.writeFile(path.join(sourceDir, 'body.md'), buildBodyMarkdown(extracted), 'utf-8');

  let title: string;
  if (structured) {
    // Handler-enriched path: emit the richer thought:Article / thought:Preprint
    // / thought:Book meta.ttl, with one dc:creator per author and bibo:doi /
    // arXiv-id / PubMed-id when present. Readability fills in whatever the
    // handler left null.
    const metadata = structuredToArticleMetadata(structured, {
      title: extracted.title,
      byline: extracted.byline,
      abstract: extracted.excerpt,
      issued: extracted.publishedTime,
      publisher: extracted.siteName,
      uri: url,
    });
    await fs.writeFile(path.join(sourceDir, 'meta.ttl'), buildArticleMetaTtl(metadata), 'utf-8');
    title = metadata.title;
  } else {
    // No site handler matched — Readability-only fallback writes a
    // thought:WebPage meta.ttl with a single byline.
    await fs.writeFile(path.join(sourceDir, 'meta.ttl'), buildMetaTtl(extracted, url), 'utf-8');
    title = extracted.title;
  }

  return { sourceId, relativePath, duplicate: false, title, kind: 'web' };
}

// ── Fetch + content-type routing ─────────────────────────────────────────

type FetchedContent =
  | { kind: 'html'; text: string }
  | { kind: 'pdf'; bytes: ArrayBuffer };

/**
 * Fetch a URL and classify it as HTML or PDF. A PDF is recognised by its
 * Content-Type (`application/pdf`) or, when the server is vague, by a `.pdf`
 * URL path. Anything else that isn't HTML/XML is rejected as before.
 */
async function fetchForIngest(url: string, f: typeof fetch): Promise<FetchedContent> {
  const res = await f(url, {
    headers: {
      // Accept both HTML and PDF; prefer HTML for content negotiation.
      'Accept': 'text/html,application/xhtml+xml,application/pdf;q=0.9,application/xml;q=0.8,*/*;q=0.7',
      // Some sites gate on UA; pretend to be a browser.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  const looksPdfByUrl = /\.pdf(?:[?#]|$)/i.test(url);
  if (ct.includes('pdf') || (looksPdfByUrl && (ct.includes('octet-stream') || ct.length === 0))) {
    return { kind: 'pdf', bytes: await res.arrayBuffer() };
  }
  if (!ct.includes('html') && !ct.includes('xml') && ct.length > 0) {
    throw new Error(`Unsupported content-type for ingest: ${ct}`);
  }
  return { kind: 'html', text: await res.text() };
}

/** Best-effort filename for a PDF fetched from a URL — the last path segment,
 *  or the host. Used as the PDF title/provenance fallback. */
function pdfFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last && /\.pdf$/i.test(last) ? last : (last ?? u.hostname);
  } catch {
    return url;
  }
}

// ── Readability extraction ──────────────────────────────────────────────

export interface ExtractedArticle {
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  publishedTime: string | null;
  lang: string | null;
  contentHtml: string;
  textContent: string;
}

export function extractReadable(html: string, url: string): ExtractedArticle {
  // linkedom gives us a standards-ish Document backed by a fast tree —
  // enough for Readability's needs without dragging undici/jsdom into
  // the main-process bundle. We have to patch `documentURI` because
  // linkedom leaves it blank, and Readability uses it to resolve
  // relative URLs in the extracted content.
  const { document } = parseHTML(html);
  Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
  Object.defineProperty(document, 'baseURI', { value: url, configurable: true });
  return extractReadableFromDoc(document, url);
}

/**
 * Same contract as `extractReadable` but takes an already-parsed linkedom
 * document so `ingestUrl` can run site handlers on the DOM without
 * parsing the HTML twice. The `documentURI` / `baseURI` setup is the
 * caller's responsibility.
 */
export function extractReadableFromDoc(document: Document, _url: string, titleFallback?: string): ExtractedArticle {
  const reader = new Readability(document);
  const article = reader.parse();
  if (!article) throw new Error('Readability could not extract content from this page');

  const byline = article.byline?.trim() || null;
  const siteName = article.siteName?.trim() || null;
  const excerpt = article.excerpt?.trim() || null;
  const publishedTime = (article as { publishedTime?: string }).publishedTime?.trim() || null;
  const lang = article.lang?.trim() || null;

  return {
    title: article.title?.trim() || titleFallback?.trim() || '(untitled)',
    byline,
    siteName,
    excerpt,
    publishedTime,
    lang,
    contentHtml: article.content ?? '',
    textContent: article.textContent?.trim() ?? '',
  };
}

// ── Markdown body ───────────────────────────────────────────────────────

export function buildBodyMarkdown(article: ExtractedArticle): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  // Keep links and images — they're frequently load-bearing for web articles.
  const body = turndown.turndown(article.contentHtml || article.textContent);
  const header = `# ${article.title}\n\n`;
  return header + body.trim() + '\n';
}

// ── Turtle meta ─────────────────────────────────────────────────────────

export function buildMetaTtl(article: ExtractedArticle, url: string | null): string {
  const lines: string[] = [
    'this: a thought:WebPage ;',
    `    dc:title ${ttlString(article.title)} ;`,
  ];
  if (url) lines.push(`    bibo:uri ${ttlString(url)} ;`);
  if (article.byline) lines.push(`    dc:creator ${ttlString(article.byline)} ;`);
  if (article.siteName) lines.push(`    dc:publisher ${ttlString(article.siteName)} ;`);
  if (article.excerpt) lines.push(`    dc:abstract ${ttlString(article.excerpt)} ;`);
  if (article.publishedTime) lines.push(`    dc:issued ${ttlString(article.publishedTime)} ;`);
  if (article.lang) lines.push(`    dc:language ${ttlString(article.lang)} ;`);
  lines.push(`    thought:accessedAt ${ttlString(new Date().toISOString())}^^xsd:dateTime .`);
  return lines.join('\n') + '\n';
}

/** Escape a string for a Turtle literal, always double-quoted. */
function ttlString(s: string): string {
  // Turtle short-string: escape backslash, quote, and common controls.
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

async function readExistingTitle(sourceDir: string): Promise<string> {
  const ttl = await fs.readFile(path.join(sourceDir, 'meta.ttl'), 'utf-8');
  const m = ttl.match(/dc:title\s+"((?:[^"\\]|\\.)*)"/);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
}
