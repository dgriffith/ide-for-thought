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
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { canonicalSourceId, normalizeUrl } from './source-id';
import { extractStructured, structuredToArticleMetadata } from './site-handlers';
import { buildMetaTtl as buildArticleMetaTtl } from './ingest-identifier';

export interface IngestResult {
  sourceId: string;
  relativePath: string;
  /** True when the source already existed; no files were overwritten. */
  duplicate: boolean;
  /** The `<title>`-derived title, for the caller to surface in a toast. */
  title: string;
}

export interface IngestOptions {
  /** Dependency-injection seam for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export async function ingestUrl(
  rootPath: string,
  rawUrl: string,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) throw new Error(`Not a valid URL: ${rawUrl}`);

  // Structured-metadata extraction (#221) needs the DOM, so we have to
  // fetch before we can decide on a canonical id. That means dedupe has
  // to happen after fetch, not before — an extra network round-trip in
  // the duplicate case, but scholarly sites dedupe straight to their
  // identifier-based folder (arxiv-<id>, doi-<id>) which is what we want.
  const html = await fetchHtml(normalized, opts.fetchImpl ?? globalThis.fetch);
  const { document } = parseHTML(html);
  Object.defineProperty(document, 'documentURI', { value: normalized, configurable: true });
  Object.defineProperty(document, 'baseURI', { value: normalized, configurable: true });

  const urlObj = new URL(normalized);
  const structured = extractStructured(document as unknown as Parameters<typeof extractStructured>[0], urlObj);

  const { id: sourceId } = canonicalSourceId({
    doi: structured?.doi ?? undefined,
    arxiv: structured?.arxiv ?? undefined,
    pubmed: structured?.pubmed ?? undefined,
    isbn: structured?.isbn ?? undefined,
    url: normalized,
  });
  const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
  const relativePath = `.minerva/sources/${sourceId}/meta.ttl`;

  // Dedupe: if meta.ttl already exists, bail. The user can delete-and-reingest
  // for a refresh; auto-overwriting would risk clobbering hand edits they've
  // made to body.md since first ingest.
  try {
    await fs.access(path.join(sourceDir, 'meta.ttl'));
    const existing = await readExistingTitle(sourceDir).catch(() => '');
    return { sourceId, relativePath, duplicate: true, title: existing };
  } catch {
    // Not found — proceed.
  }

  const extracted = extractReadableFromDoc(document as unknown as Document, normalized);

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
      uri: normalized,
    });
    await fs.writeFile(path.join(sourceDir, 'meta.ttl'), buildArticleMetaTtl(metadata), 'utf-8');
    title = metadata.title;
  } else {
    // No site handler matched — Readability-only fallback writes a
    // thought:WebPage meta.ttl with a single byline.
    await fs.writeFile(path.join(sourceDir, 'meta.ttl'), buildMetaTtl(extracted, normalized), 'utf-8');
    title = extracted.title;
  }

  return { sourceId, relativePath, duplicate: false, title };
}

// ── HTML fetch ──────────────────────────────────────────────────────────

async function fetchHtml(url: string, f: typeof fetch): Promise<string> {
  const res = await f(url, {
    // Respect the server's content negotiation while preferring HTML.
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      // Some sites gate on UA; pretend to be a browser.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.includes('html') && !ct.includes('xml') && ct.length > 0) {
    throw new Error(`Unsupported content-type for ingest: ${ct}`);
  }
  return await res.text();
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
  return extractReadableFromDoc(document as unknown as Document, url);
}

/**
 * Same contract as `extractReadable` but takes an already-parsed linkedom
 * document so `ingestUrl` can run site handlers on the DOM without
 * parsing the HTML twice. The `documentURI` / `baseURI` setup is the
 * caller's responsibility.
 */
export function extractReadableFromDoc(document: Document, _url: string): ExtractedArticle {
  const reader = new Readability(document);
  const article = reader.parse();
  if (!article) throw new Error('Readability could not extract content from this page');

  const byline = article.byline?.trim() || null;
  const siteName = article.siteName?.trim() || null;
  const excerpt = article.excerpt?.trim() || null;
  const publishedTime = (article as { publishedTime?: string }).publishedTime?.trim() || null;
  const lang = article.lang?.trim() || null;

  return {
    title: article.title?.trim() || '(untitled)',
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

export function buildMetaTtl(article: ExtractedArticle, url: string): string {
  const lines: string[] = [
    'this: a thought:WebPage ;',
    `    dc:title ${ttlString(article.title)} ;`,
    `    bibo:uri ${ttlString(url)} ;`,
  ];
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
