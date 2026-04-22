/**
 * Site-specific structured-metadata extraction (#221).
 *
 * Before we fall back to Readability's heuristic extraction, pages that
 * expose structured bibliographic metadata (arXiv, PubMed, Semantic
 * Scholar, most publisher pages) let us pull authors, DOI / arXiv id,
 * publication date, journal title straight out of the page. That fixes
 * the classic Readability-byline-is-wrong symptom on arXiv
 * (`dc:creator "[Submitted on 20 Apr 2026]"`) and upgrades the canonical
 * id from `url-<hash>` to `arxiv-<id>` / `doi-<id>` when identifiers are
 * available.
 *
 * The Google-Scholar-era `<meta name="citation_*">` convention is the
 * dominant source format in the wild — most scholarly publishers
 * implement it, and a generic handler captures them all in one pass.
 * Per-site handlers stack on top for URL-pattern fallbacks (the arXiv
 * abs / pdf URL structure tells us the arXiv id even when a PDF
 * response doesn't carry the meta tags).
 */

import type { ArticleMetadata } from './api-adapters/types';

/**
 * Partial metadata derived from site-handler inspection. The ingest
 * orchestrator merges this with Readability's body extraction — handler
 * fields win for structured bibliographic data; Readability fills body
 * text, excerpt, and whatever the handler left null.
 */
export interface StructuredExtraction {
  title?: string | null;
  creators?: string[];
  abstract?: string | null;
  issued?: string | null;
  publisher?: string | null;
  containerTitle?: string | null;
  doi?: string | null;
  arxiv?: string | null;
  pubmed?: string | null;
  isbn?: string | null;
  pdfUrl?: string | null;
  /** The site-handler's subtype inference (Article / Preprint / Book …). */
  subtype?: ArticleMetadata['subtype'];
}

/**
 * DOM contract that matches both linkedom and the native Document type,
 * so the module is testable without importing either into a test that
 * already has a jsdom-ish environment.
 */
export interface DocLike {
  querySelectorAll(selector: string): ArrayLike<MetaLike>;
  querySelector(selector: string): MetaLike | null;
}
interface MetaLike {
  getAttribute(name: string): string | null;
}

/**
 * Run every known site handler against a DOM and a URL. Merges their
 * outputs with later handlers filling in gaps left by earlier ones.
 * Returns null when no handler contributed anything.
 */
export function extractStructured(doc: DocLike, url: URL): StructuredExtraction | null {
  const handlers = [citationMetaHandler, arxivUrlHandler, pubmedUrlHandler];
  let out: StructuredExtraction | null = null;
  for (const handler of handlers) {
    const result = handler(doc, url);
    if (!result) continue;
    out = out ? mergeExtractions(out, result) : result;
  }
  return out;
}

/**
 * Merge two extractions with the first argument taking priority — it's
 * the accumulator, so later handlers can only fill in gaps rather than
 * override a high-confidence earlier extraction.
 */
function mergeExtractions(a: StructuredExtraction, b: StructuredExtraction): StructuredExtraction {
  return {
    title: a.title ?? b.title,
    creators: a.creators && a.creators.length > 0 ? a.creators : b.creators,
    abstract: a.abstract ?? b.abstract,
    issued: a.issued ?? b.issued,
    publisher: a.publisher ?? b.publisher,
    containerTitle: a.containerTitle ?? b.containerTitle,
    doi: a.doi ?? b.doi,
    arxiv: a.arxiv ?? b.arxiv,
    pubmed: a.pubmed ?? b.pubmed,
    isbn: a.isbn ?? b.isbn,
    pdfUrl: a.pdfUrl ?? b.pdfUrl,
    subtype: a.subtype ?? b.subtype,
  };
}

// ── Citation meta handler (Google Scholar convention) ──────────────────────

/**
 * The `<meta name="citation_*">` convention that Google Scholar indexes
 * on. Most publisher pages populate at least title + author + DOI /
 * journal. arXiv, PubMed, Semantic Scholar, IEEE Xplore, ACM DL, SSRN,
 * Nature, Cell, Elsevier journals — all of them. The handler activates
 * whenever `citation_title` is present, regardless of host.
 */
export function citationMetaHandler(doc: DocLike, _url: URL): StructuredExtraction | null {
  const title = metaContent(doc, 'citation_title');
  if (!title) return null;

  const creators = metaContentsAll(doc, 'citation_author');
  const doiRaw = metaContent(doc, 'citation_doi');
  const arxivRaw = metaContent(doc, 'citation_arxiv_id');
  const pubmedRaw = metaContent(doc, 'citation_pmid')
    ?? metaContent(doc, 'citation_pubmed_id');
  const isbnRaw = metaContent(doc, 'citation_isbn');
  const dateRaw = metaContent(doc, 'citation_publication_date')
    ?? metaContent(doc, 'citation_date');
  const journal = metaContent(doc, 'citation_journal_title')
    ?? metaContent(doc, 'citation_conference_title');
  const publisher = metaContent(doc, 'citation_publisher');
  const abstractRaw = metaContent(doc, 'citation_abstract')
    ?? metaContent(doc, 'description');
  const pdfUrl = metaContent(doc, 'citation_pdf_url');

  // Authors sometimes come as a single `citation_author` value with
  // semicolons (older Elsevier pages). Split if that looks like what
  // we got instead of one meta tag per author.
  const resolvedCreators = creators.length > 1
    ? creators
    : creators.length === 1 && creators[0].includes(';')
      ? creators[0].split(';').map((c) => c.trim()).filter(Boolean)
      : creators;

  const subtype: ArticleMetadata['subtype'] | undefined =
    arxivRaw ? 'Preprint' :
    journal ? 'Article' :
    isbnRaw ? 'Book' :
    undefined;

  return {
    title,
    creators: resolvedCreators.length > 0 ? resolvedCreators : undefined,
    abstract: abstractRaw ?? null,
    issued: normalizeCitationDate(dateRaw),
    publisher: publisher ?? null,
    containerTitle: journal ?? null,
    doi: normalizeDoi(doiRaw),
    arxiv: normalizeArxivId(arxivRaw),
    pubmed: normalizePubmed(pubmedRaw),
    isbn: normalizeIsbn(isbnRaw),
    pdfUrl: pdfUrl ?? null,
    subtype,
  };
}

/**
 * arXiv URL fallback — some pages (PDF responses, old abs-page variants)
 * don't include the citation_arxiv_id tag, but the URL itself carries
 * the id. Only fires on the arxiv.org host so we don't misread random
 * other URLs.
 */
export function arxivUrlHandler(_doc: DocLike, url: URL): StructuredExtraction | null {
  if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) return null;
  // /abs/2604.18561, /abs/2604.18561v2, /pdf/2604.18561(.pdf)?
  const m = url.pathname.match(/\/(?:abs|pdf)\/([a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i);
  if (!m) return null;
  return { arxiv: m[1], subtype: 'Preprint' };
}

/**
 * PubMed URL fallback — the numeric PMID is typically the last path
 * segment. Gives us a non-hash canonical id even when the landing
 * page's meta tags are sparse.
 */
export function pubmedUrlHandler(_doc: DocLike, url: URL): StructuredExtraction | null {
  if (!/ncbi\.nlm\.nih\.gov$/i.test(url.hostname) && !/pubmed\.ncbi\.nlm\.nih\.gov$/i.test(url.hostname)) {
    return null;
  }
  const m = url.pathname.match(/\/(?:pubmed|pmc)\/(\d+)/i) ?? url.pathname.match(/\/(\d{4,})\/?$/);
  if (!m) return null;
  return { pubmed: m[1] };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function metaContent(doc: DocLike, name: string): string | null {
  // Some publishers use `name=`; rarer `property=` (OpenGraph-ish). Try
  // both — cheap, and covers a long tail of publisher variations.
  const nameMatch = doc.querySelector(`meta[name="${name}"]`);
  if (nameMatch) {
    const v = nameMatch.getAttribute('content');
    if (v && v.trim()) return v.trim();
  }
  const propertyMatch = doc.querySelector(`meta[property="${name}"]`);
  if (propertyMatch) {
    const v = propertyMatch.getAttribute('content');
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function metaContentsAll(doc: DocLike, name: string): string[] {
  const out: string[] = [];
  const nodes = doc.querySelectorAll(`meta[name="${name}"]`);
  for (let i = 0; i < nodes.length; i++) {
    const v = nodes[i].getAttribute('content');
    if (v && v.trim()) out.push(v.trim());
  }
  if (out.length === 0) {
    const propNodes = doc.querySelectorAll(`meta[property="${name}"]`);
    for (let i = 0; i < propNodes.length; i++) {
      const v = propNodes[i].getAttribute('content');
      if (v && v.trim()) out.push(v.trim());
    }
  }
  return out;
}

export function normalizeCitationDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Already ISO-shaped: YYYY, YYYY-MM, YYYY-MM-DD.
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(trimmed)) return trimmed;
  // Google Scholar also accepts `YYYY/MM/DD`, which some older publishers emit.
  const slash = trimmed.match(/^(\d{4})\/(\d{1,2})(?:\/(\d{1,2}))?$/);
  if (slash) {
    const [, y, m, d] = slash;
    if (d) return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return `${y}-${m.padStart(2, '0')}`;
  }
  // Last resort: pull the first 4-digit run.
  const year = trimmed.match(/(\d{4})/);
  return year ? year[1] : null;
}

function normalizeDoi(raw: string | null): string | null {
  if (!raw) return null;
  const stripped = raw.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  return /^10\.\d+\/.+/.test(stripped) ? stripped : null;
}

function normalizeArxivId(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^arxiv:\s*/i, '').replace(/v\d+$/i, '');
  // New style
  if (/^\d{4}\.\d{4,5}$/.test(trimmed)) return trimmed;
  // Old style
  if (/^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

function normalizePubmed(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^pmid:\s*/i, '');
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function normalizeIsbn(raw: string | null): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/[\s-]/g, '');
  return stripped.length >= 10 ? stripped : null;
}

// ── Translation to ArticleMetadata ──────────────────────────────────────────

/**
 * Convert a `StructuredExtraction` (enriched with Readability fall-backs
 * by the caller) into the `ArticleMetadata` shape the rest of the ingest
 * pipeline consumes. Readability is the fallback for anything the
 * handler didn't fill in — title and abstract especially, since some
 * handlers return just identifiers.
 */
export function structuredToArticleMetadata(
  structured: StructuredExtraction,
  fallback: {
    title: string;
    byline?: string | null;
    abstract?: string | null;
    issued?: string | null;
    publisher?: string | null;
    uri?: string | null;
  },
): ArticleMetadata {
  const title = structured.title ?? fallback.title;
  const creators = structured.creators && structured.creators.length > 0
    ? structured.creators
    : fallback.byline ? [fallback.byline] : [];
  const abstract = structured.abstract ?? fallback.abstract ?? null;
  const issued = structured.issued ?? fallback.issued ?? null;
  const publisher = structured.publisher ?? fallback.publisher ?? null;

  const subtype: ArticleMetadata['subtype'] = structured.subtype ?? inferSubtype(structured);

  return {
    subtype,
    title,
    creators,
    abstract,
    issued,
    publisher,
    containerTitle: structured.containerTitle ?? null,
    doi: structured.doi ?? null,
    isbn: structured.isbn ?? null,
    arxiv: structured.arxiv ?? null,
    pubmed: structured.pubmed ?? null,
    uri: fallback.uri ?? null,
    pdfUrl: structured.pdfUrl ?? null,
    category: null,
  };
}

function inferSubtype(s: StructuredExtraction): ArticleMetadata['subtype'] {
  if (s.arxiv) return 'Preprint';
  if (s.isbn) return 'Book';
  if (s.containerTitle) return 'Article';
  if (s.doi || s.pubmed) return 'Article';
  return 'Source';
}
