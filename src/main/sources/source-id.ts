/**
 * Canonical identifier rules for Sources.
 *
 * A Source (article, paper, book, web page, …) is stored under
 * `.minerva/sources/<id>/` where `<id>` is derived from its most-stable
 * identifier. Priority, highest first:
 *
 *   1. DOI            (`doi-10.1038_s41586-023-06924-6`)
 *   2. arXiv ID       (`arxiv-2301.12345`)
 *   3. PubMed ID      (`pmid-12345678`)
 *   4. ISBN-13        (`isbn-9780140449136`)
 *   5. normalized URL (`url-<12-char-hash>`)
 *   6. content hash   (`sha-<12-char-hash>`)
 *
 * All ids are filename-safe and lowercase. Ingesting the same paper
 * twice — regardless of which field the user happened to supply —
 * produces the same id, so dedupe-on-ingest is just an existence check
 * on the resulting folder.
 */

import { createHash } from 'node:crypto';

export interface SourceIdentifiers {
  doi?: string;
  arxiv?: string;
  pubmed?: string;
  isbn?: string;
  url?: string;
}

export type CanonicalIdMethod = 'doi' | 'arxiv' | 'pubmed' | 'isbn' | 'url' | 'hash';

export interface CanonicalId {
  id: string;
  method: CanonicalIdMethod;
}

/**
 * Compute the canonical source id from any combination of identifiers.
 * Walks the priority list and returns the first viable id. When none of
 * the structured ids is present, falls back to a hash of `contentHashSeed`
 * (a caller-supplied string — typically the full page body or URL).
 *
 * Throws when no identifier AND no seed is supplied — callers should
 * always pass at least something to hash.
 */
export function canonicalSourceId(
  ids: SourceIdentifiers,
  contentHashSeed?: string,
): CanonicalId {
  if (ids.doi) {
    const doi = normalizeDoi(ids.doi);
    if (doi) return { id: `doi-${doi.replace(/\//g, '_')}`, method: 'doi' };
  }
  if (ids.arxiv) {
    const arxiv = normalizeArxivId(ids.arxiv);
    if (arxiv) return { id: `arxiv-${arxiv}`, method: 'arxiv' };
  }
  if (ids.pubmed) {
    const pmid = normalizePubmedId(ids.pubmed);
    if (pmid) return { id: `pmid-${pmid}`, method: 'pubmed' };
  }
  if (ids.isbn) {
    const isbn = normalizeIsbn(ids.isbn);
    if (isbn) return { id: `isbn-${isbn}`, method: 'isbn' };
  }
  if (ids.url) {
    const url = normalizeUrl(ids.url);
    if (url) return { id: `url-${shortHash(url)}`, method: 'url' };
  }
  if (contentHashSeed) {
    return { id: `sha-${shortHash(contentHashSeed)}`, method: 'hash' };
  }
  throw new Error('canonicalSourceId: no identifiers and no contentHashSeed provided');
}

/**
 * Normalize a DOI: strip any URL prefix, lowercase, remove whitespace.
 * Returns the bare `10.xxxx/…` form, or null if the input isn't DOI-shaped.
 */
export function normalizeDoi(doi: string): string | null {
  const trimmed = doi.trim();
  if (!trimmed) return null;
  // Strip common prefixes: doi: / https://doi.org/ / http://dx.doi.org/ …
  const stripped = trimmed
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  const lower = stripped.toLowerCase();
  // DOIs start with 10. followed by a registrant code, then `/`, then suffix.
  return /^10\.\d+\/.+/.test(lower) ? lower : null;
}

/**
 * Normalize an arXiv id: strip optional `arXiv:` prefix and version suffix
 * (`v1`, `v2`, …). Accepts both the new (`YYMM.NNNNN`) and old (`math/0123456`)
 * formats. Returns null for anything that doesn't look like one of these.
 */
export function normalizeArxivId(arxiv: string): string | null {
  const trimmed = arxiv.trim().replace(/^arxiv:\s*/i, '');
  if (!trimmed) return null;
  // Strip version suffix: 2301.12345v2 → 2301.12345.
  const noVer = trimmed.replace(/v\d+$/i, '');
  const lower = noVer.toLowerCase();
  // New-style: YYMM.NNNNN(N).
  if (/^\d{4}\.\d{4,5}$/.test(lower)) return lower;
  // Old-style: archive[.subcategory]/YYMMNNN — e.g. math/0512001,
  // cond-mat.stat-mech/0512123.
  if (/^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/.test(lower)) return lower.replace(/\//g, '_');
  return null;
}

/** Normalize a PubMed id: strip optional `pmid:` prefix, keep the numeric suffix. */
export function normalizePubmedId(pmid: string): string | null {
  const trimmed = pmid.trim().replace(/^pmid:\s*/i, '');
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

/**
 * Normalize an ISBN to the 13-digit form, stripping hyphens and spaces.
 * Accepts ISBN-10 input and converts it via the standard 978-prefix +
 * checksum-recompute procedure. Returns null for anything that isn't a
 * valid ISBN-10 or ISBN-13 (checksum included).
 */
export function normalizeIsbn(isbn: string): string | null {
  const raw = isbn.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(raw)) return isIsbn13Valid(raw) ? raw : null;
  if (/^\d{9}[\dX]$/.test(raw)) {
    if (!isIsbn10Valid(raw)) return null;
    return isbn10ToIsbn13(raw);
  }
  return null;
}

/**
 * Normalize a URL for dedupe purposes:
 *  - Lowercase the scheme + host.
 *  - Strip a leading `www.` from the host.
 *  - Strip the fragment (`#…`).
 *  - Strip tracking query params (`utm_*`, `fbclid`, `gclid`, …).
 *  - Sort the remaining query params alphabetically so `?a=1&b=2` and
 *    `?b=2&a=1` hash to the same key.
 *  - Strip a trailing slash on a non-empty path.
 *
 * Returns null when the input isn't parseable as a URL.
 */
export function normalizeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  parsed.hash = '';
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

  // Filter + sort query params.
  const remaining: [string, string][] = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (isTrackingParam(k)) continue;
    remaining.push([k, v]);
  }
  remaining.sort(([a], [b]) => a.localeCompare(b));
  parsed.search = '';
  for (const [k, v] of remaining) parsed.searchParams.append(k, v);

  // Strip trailing slash on a non-root path.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_name', 'utm_brand', 'utm_social', 'utm_social-type',
  'fbclid', 'gclid', 'msclkid', 'yclid', 'dclid',
  'mc_eid', 'mc_cid',
  'ref', 'ref_src', 'ref_url',
  '_ga', '_gl',
  'hsctatracking',
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return lower.startsWith('utm_');
}

/** sha256 of the input, truncated to the first 12 hex chars (48 bits). */
export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

// ── ISBN checksum helpers ────────────────────────────────────────────────

function isIsbn10Valid(isbn10: string): boolean {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(isbn10[i], 10) * (10 - i);
  const last = isbn10[9];
  sum += last === 'X' ? 10 : parseInt(last, 10);
  return sum % 11 === 0;
}

function isIsbn13Valid(isbn13: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = parseInt(isbn13[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return sum % 10 === 0;
}

function isbn10ToIsbn13(isbn10: string): string {
  const base = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(base[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const checksum = (10 - (sum % 10)) % 10;
  return base + String(checksum);
}
