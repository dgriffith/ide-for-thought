/**
 * CrossRef Works API adapter.
 *
 * Docs: https://api.crossref.org/swagger-ui/index.html
 *
 * We fetch `/works/{doi}`; the response's `message` object carries every
 * field CrossRef has on the record — title, authors, journal, dates,
 * abstract (JATS), and often a `link[]` array pointing at the publisher
 * PDF when open-access.
 */

import type { ArticleMetadata } from './types';

/** Endpoint prefix; broken out for tests. */
export const CROSSREF_ENDPOINT = 'https://api.crossref.org/works';

/**
 * Shape of the bits we read from CrossRef's JSON response. Deliberately
 * narrow — every field is optional so a malformed record degrades to
 * missing metadata rather than crashing the ingest.
 */
export interface CrossrefWork {
  DOI?: string;
  URL?: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  'published-print'?: { 'date-parts'?: number[][] };
  'published-online'?: { 'date-parts'?: number[][] };
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  publisher?: string;
  abstract?: string;
  link?: Array<{ URL?: string; 'content-type'?: string; 'content-version'?: string }>;
  ISBN?: string[];
}

export async function fetchCrossrefMetadata(
  doi: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ArticleMetadata> {
  const url = `${CROSSREF_ENDPOINT}/${encodeURIComponent(doi)}`;
  const res = await fetchImpl(url, {
    headers: {
      'Accept': 'application/json',
      // CrossRef asks consumers to identify themselves so they can reach out
      // when something goes wrong. Minimal polite-pool compliance.
      'User-Agent': 'Minerva/1.0 (https://minerva.dev; mailto:ingest@minerva.local)',
    },
  });
  if (!res.ok) {
    throw new Error(`CrossRef ${res.status}: ${res.statusText}`);
  }
  const payload = await res.json() as { message?: CrossrefWork };
  const work = payload.message;
  if (!work) throw new Error(`CrossRef: empty response body for DOI ${doi}`);
  return parseCrossrefWork(work, doi);
}

export function parseCrossrefWork(work: CrossrefWork, doi: string): ArticleMetadata {
  const title = (work.title?.[0] ?? '').trim() || '(untitled)';
  const creators = (work.author ?? [])
    .map((a) => {
      if (a.name) return a.name.trim();
      const full = [a.given, a.family].filter(Boolean).join(' ').trim();
      return full;
    })
    .filter((s) => s.length > 0);
  const issued = firstDateString(work.issued)
    ?? firstDateString(work['published-print'])
    ?? firstDateString(work['published-online'])
    ?? null;
  const containerTitle = (work['container-title']?.[0] ?? '').trim() || null;
  const abstract = work.abstract ? stripJats(work.abstract) : null;
  const isbn = work.ISBN?.[0]?.trim() || null;
  const pdfUrl = pickPdfLink(work.link);
  const subtype = mapSubtype(work.type);

  return {
    subtype,
    title,
    creators,
    abstract,
    issued,
    publisher: work.publisher?.trim() || null,
    containerTitle,
    doi,
    isbn,
    arxiv: null,
    pubmed: null,
    uri: work.URL?.trim() || `https://doi.org/${doi}`,
    pdfUrl,
    category: null,
  };
}

function firstDateString(
  field: { 'date-parts'?: number[][] } | undefined,
): string | null {
  const parts = field?.['date-parts']?.[0];
  if (!parts || parts.length === 0) return null;
  const [year, month, day] = parts;
  if (!year) return null;
  const mm = month != null ? String(month).padStart(2, '0') : null;
  const dd = day != null ? String(day).padStart(2, '0') : null;
  if (mm && dd) return `${year}-${mm}-${dd}`;
  if (mm) return `${year}-${mm}`;
  return String(year);
}

/**
 * CrossRef's abstract field arrives wrapped in JATS XML (`<jats:p>…</jats:p>`).
 * We render-safe strip tags and collapse whitespace for the `dc:abstract`
 * literal — the abstract is going into a Turtle string, not HTML.
 */
function stripJats(jats: string): string {
  return jats
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim() || null as unknown as string;
}

function pickPdfLink(links: CrossrefWork['link']): string | null {
  if (!links) return null;
  // Prefer a `vor` (version-of-record) PDF over `am` (accepted manuscript)
  // when multiple candidates appear.
  const pdfs = links.filter((l) => l['content-type']?.includes('pdf') && l.URL);
  const vor = pdfs.find((l) => l['content-version'] === 'vor');
  return (vor?.URL ?? pdfs[0]?.URL ?? null) || null;
}

function mapSubtype(type: string | undefined): ArticleMetadata['subtype'] {
  switch (type) {
    case 'journal-article':
    case 'proceedings-article':
    case 'book-chapter':
    case 'book-section':
    case 'book-part':
    case 'reference-entry':
      return 'Article';
    case 'book':
    case 'monograph':
    case 'reference-book':
    case 'edited-book':
      return 'Book';
    case 'posted-content':
      return 'Preprint';
    case 'report':
    case 'report-series':
      return 'Report';
    default:
      return 'Source';
  }
}
