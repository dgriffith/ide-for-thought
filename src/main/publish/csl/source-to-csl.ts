/**
 * Convert a Minerva `Source` (as its `meta.ttl` on disk) into the
 * CSL-JSON shape citeproc-js consumes (#247).
 *
 * TTL is our source-of-truth, not CSL — but CSL is what citeproc speaks.
 * The mapping has to be lossy in one direction (a few TTL-specific
 * predicates like `thought:accessedAt` have no CSL analogue) and
 * opinionated in another (author strings get best-effort split into
 * `family` / `given` because APA-style inline marks need the family
 * name alone: "(Brooks, 1987)" rather than "(Frederick P. Brooks, 1987)").
 */

export interface CslName {
  family?: string;
  given?: string;
  suffix?: string;
  /** Used for institutional / unsplittable authors; citeproc emits verbatim. */
  literal?: string;
}

export interface CslItem {
  id: string;
  /** CSL item type — matches citeproc's vocabulary, not our thought:* shapes. */
  type: string;
  title?: string;
  author?: CslName[];
  issued?: { 'date-parts': number[][] };
  'container-title'?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  abstract?: string;
}

/**
 * Parse a source's `meta.ttl` into a CSL-JSON item. The TTL shape is
 * what our ingest code produces, so a thin regex-based extractor is
 * good enough — we don't need a full RDF parser.
 */
export function sourceTtlToCsl(ttl: string, id: string): CslItem {
  const type = mapType(extractTypeIri(ttl));
  const title = extractLiteral(ttl, 'dc:title');
  const creators = extractAllLiterals(ttl, 'dc:creator').map(parseAuthorName);
  const issuedRaw = extractLiteral(ttl, 'dc:issued');
  const issued = issuedRaw ? parseIssuedDate(issuedRaw) : undefined;
  const container = extractLiteral(ttl, 'schema:inContainer');
  const publisher = extractLiteral(ttl, 'dc:publisher');
  const volume = extractLiteral(ttl, 'bibo:volume');
  const issue = extractLiteral(ttl, 'bibo:issue');
  const page = extractLiteral(ttl, 'bibo:pages');
  const doi = extractLiteral(ttl, 'bibo:doi');
  const uri = extractIri(ttl, 'bibo:uri') ?? extractLiteral(ttl, 'bibo:uri');
  const abstract = extractLiteral(ttl, 'dc:abstract');

  const item: CslItem = { id, type };
  if (title) item.title = title;
  if (creators.length > 0) item.author = creators;
  if (issued) item.issued = issued;
  if (container) item['container-title'] = container;
  if (publisher) item.publisher = publisher;
  if (volume) item.volume = volume;
  if (issue) item.issue = issue;
  if (page) item.page = page;
  if (doi) item.DOI = doi;
  if (uri) item.URL = uri;
  if (abstract) item.abstract = abstract;
  return item;
}

// ── Type mapping ────────────────────────────────────────────────────────────

/**
 * Map our `thought:*` type IRIs to CSL item types. CSL's vocabulary is
 * broader; we stick to the handful that cover what ingest emits.
 */
function mapType(typeLocal: string | null): string {
  switch (typeLocal) {
    case 'Article': return 'article-journal';
    case 'Book': return 'book';
    case 'Report': return 'report';
    case 'Preprint': return 'article';  // CSL treats preprints as generic "article"
    case 'WebPage': return 'webpage';
    case 'PDFSource': return 'article';
    case 'Source': return 'article';
    default: return 'article';
  }
}

function extractTypeIri(ttl: string): string | null {
  const m = ttl.match(/this:\s*a\s+thought:(\w+)\s*[;.]/);
  return m ? m[1] : null;
}

// ── Field extractors ───────────────────────────────────────────────────────

/**
 * Pull the first `predicate "value"` double-quoted literal. Tolerates
 * typed literals (`"…"^^xsd:date`), trailing `;` vs `.`, and escaped
 * quotes — matches what our ingest writes.
 */
export function extractLiteral(ttl: string, predicate: string): string | null {
  const re = new RegExp(`${escapeRegex(predicate)}\\s+"((?:[^"\\\\]|\\\\.)*)"`);
  const m = ttl.match(re);
  if (!m) return null;
  const unescaped = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return unescaped.trim() || null;
}

function extractAllLiterals(ttl: string, predicate: string): string[] {
  const re = new RegExp(`${escapeRegex(predicate)}\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(ttl)) !== null) {
    const unescaped = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (unescaped.trim()) out.push(unescaped.trim());
  }
  return out;
}

function extractIri(ttl: string, predicate: string): string | null {
  const re = new RegExp(`${escapeRegex(predicate)}\\s+<([^>]+)>`);
  const m = ttl.match(re);
  return m ? m[1] : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Author-name heuristics ─────────────────────────────────────────────────

const SUFFIXES = new Set(['Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV', 'V']);
/** Known institutional tokens we shouldn't try to family/given-split. */
const INSTITUTIONAL_HINTS = /\b(Institute|University|Corporation|Group|Committee|Foundation|Society|Club|Consortium|Inc\.?|Ltd\.?|Association|Organization|Board|Council)\b/i;

/**
 * Best-effort split a human-readable name string into CSL name parts.
 * Handles Western "First Last", surname-first "Last, First", trailing
 * suffixes ("Last, Jr."), and routes obviously-institutional strings
 * through `literal`.
 */
export function parseAuthorName(raw: string): CslName {
  const trimmed = raw.trim();
  if (!trimmed) return { literal: '' };

  if (INSTITUTIONAL_HINTS.test(trimmed)) return { literal: trimmed };

  // Strip a trailing suffix if present ("Brooks, Jr." or "Brooks Jr.").
  let suffix: string | undefined;
  let body = trimmed;
  const suffixMatch = body.match(/^(.*?),\s*([A-Z][a-zA-Z.]{0,3})$/);
  if (suffixMatch && SUFFIXES.has(suffixMatch[2])) {
    body = suffixMatch[1].trim();
    suffix = suffixMatch[2];
  } else {
    const trailingSuffix = body.match(/^(.*?)\s+(Jr\.|Sr\.|III|II|IV|V)$/);
    if (trailingSuffix && SUFFIXES.has(trailingSuffix[2])) {
      body = trailingSuffix[1].trim();
      suffix = trailingSuffix[2];
    }
  }

  if (!body) return suffix ? { literal: suffix } : { literal: trimmed };

  // Surname-first form: "Brooks, Frederick P."
  if (body.includes(',')) {
    const [family, given] = body.split(',', 2).map((s) => s.trim());
    if (family) {
      const name: CslName = { family };
      if (given) name.given = given;
      if (suffix) name.suffix = suffix;
      return name;
    }
  }

  // Single-token name — could be a mononym or an institution we missed.
  const tokens = body.split(/\s+/);
  if (tokens.length === 1) {
    return suffix ? { family: tokens[0], suffix } : { literal: tokens[0] };
  }

  // Western "First [Middle] Last" — last token is family, rest is given.
  const family = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1).join(' ');
  const name: CslName = { family, given };
  if (suffix) name.suffix = suffix;
  return name;
}

// ── Date parsing ───────────────────────────────────────────────────────────

/**
 * Parse an ISO-shaped date string — `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` —
 * into CSL's `date-parts` shape. Anything weirder gets the most-precise
 * prefix we can extract, falling back to null.
 */
export function parseIssuedDate(raw: string): { 'date-parts': number[][] } | undefined {
  const t = raw.trim();
  const m = t.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  if (!m) return undefined;
  const y = parseInt(m[1], 10);
  const mo = m[2] ? parseInt(m[2], 10) : undefined;
  const d = m[3] ? parseInt(m[3], 10) : undefined;
  const parts: number[] = [y];
  if (mo !== undefined) parts.push(mo);
  if (d !== undefined) parts.push(d);
  return { 'date-parts': [parts] };
}

// ── Excerpt parsing ────────────────────────────────────────────────────────

export interface ExcerptInfo {
  id: string;
  /** The `sources:<id>` fragment this excerpt quotes from. */
  sourceId: string;
  /** CSL `locator` string: "12" for a page, "12-15" for a range. */
  locator?: string;
  /** Literal passage the excerpt captures; exposed for UI tooltips, not citation. */
  citedText?: string;
}

/**
 * Parse an excerpt's `meta.ttl` into the fields the citation path needs.
 * `thought:fromSource sources:<id>` → the source; `thought:page` /
 * `thought:pageRange` become a CSL locator string.
 */
export function excerptTtlToInfo(ttl: string, id: string): ExcerptInfo | null {
  const sourceMatch = ttl.match(/thought:fromSource\s+sources:([\w\-.]+)/);
  if (!sourceMatch) return null;
  const sourceId = sourceMatch[1];
  const pageLit = ttl.match(/thought:page\s+(\d+)/);
  const rangeLit = extractLiteral(ttl, 'thought:pageRange');
  const locator = rangeLit ?? (pageLit ? pageLit[1] : undefined);
  const citedText = extractLiteral(ttl, 'thought:citedText') ?? undefined;
  return { id, sourceId, locator, citedText };
}
