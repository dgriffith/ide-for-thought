/**
 * PubMed E-utilities adapter.
 *
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25500/
 *
 * esummary returns a compact JSON record that's enough for the sidebar
 * Sources panel and `dc:*` predicates. The abstract lives in a separate
 * efetch call (EFetch returns XML); we run both and merge.
 */

import { DOMParser } from 'linkedom';
import type { ArticleMetadata } from './types';

export const PUBMED_SUMMARY = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
export const PUBMED_FETCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';

interface PubmedEsummary {
  result?: {
    uids?: string[];
    [uid: string]: {
      uid?: string;
      title?: string;
      authors?: Array<{ name?: string; authtype?: string }>;
      pubdate?: string;
      epubdate?: string;
      source?: string;
      fulljournalname?: string;
      articleids?: Array<{ idtype?: string; value?: string }>;
    } | string[] | undefined;
  };
}

export async function fetchPubmedMetadata(
  pmid: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ArticleMetadata> {
  const summary = await fetchSummary(pmid, fetchImpl);
  const abstract = await fetchAbstract(pmid, fetchImpl).catch(() => null);
  return buildMetadata(pmid, summary, abstract);
}

async function fetchSummary(pmid: string, fetchImpl: typeof fetch): Promise<PubmedEsummary> {
  const url = `${PUBMED_SUMMARY}?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`PubMed esummary ${res.status}: ${res.statusText}`);
  return await res.json() as PubmedEsummary;
}

async function fetchAbstract(pmid: string, fetchImpl: typeof fetch): Promise<string | null> {
  const url = `${PUBMED_FETCH}?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=xml&rettype=abstract`;
  const res = await fetchImpl(url);
  if (!res.ok) return null;
  const xml = await res.text();
  return parseAbstractXml(xml);
}

/** Exposed for tests. */
export function parseAbstractXml(xml: string): string | null {
  // linkedom's DOMParser returns `any`; cast at the boundary so downstream
  // queries are type-checked. (Same pattern as arxiv.ts.)
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
  const parts: string[] = [];
  for (const el of doc.querySelectorAll('AbstractText')) {
    const text = el.textContent?.trim();
    if (!text) continue;
    const label = el.getAttribute('Label');
    parts.push(label ? `${label}: ${text}` : text);
  }
  if (parts.length === 0) return null;
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Exposed for tests. */
export function buildMetadata(
  pmid: string,
  summary: PubmedEsummary,
  abstract: string | null,
): ArticleMetadata {
  const record = summary.result?.[pmid] as {
    title?: string;
    authors?: Array<{ name?: string; authtype?: string }>;
    pubdate?: string;
    fulljournalname?: string;
    source?: string;
    articleids?: Array<{ idtype?: string; value?: string }>;
  } | undefined;
  if (!record) {
    throw new Error(`PubMed: no record for PMID ${pmid}`);
  }

  const title = (record.title ?? '').trim().replace(/\.$/, '') || '(untitled)';
  const creators = (record.authors ?? [])
    .filter((a) => a.authtype === 'Author' || a.authtype === undefined)
    .map((a) => a.name?.trim() ?? '')
    .filter((s) => s.length > 0);

  const issued = normalizePubDate(record.pubdate);
  const containerTitle = (record.fulljournalname ?? record.source ?? '').trim() || null;

  let doi: string | null = null;
  for (const aid of record.articleids ?? []) {
    if (aid.idtype === 'doi' && aid.value) {
      doi = aid.value.trim();
      break;
    }
  }

  return {
    subtype: 'Article',
    title,
    creators,
    abstract,
    issued,
    publisher: null,
    containerTitle,
    doi,
    isbn: null,
    arxiv: null,
    pubmed: pmid,
    uri: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    pdfUrl: null,
    category: null,
  };
}

/**
 * PubMed's `pubdate` is freeform: `"2023 Jan 15"`, `"2023 Jan"`, `"2023"`,
 * or even `"2023 Jan-Feb"`. We parse conservatively into an ISO-ish shape,
 * falling back to the year when the month isn't a clean name.
 */
function normalizePubDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/);
  const year = parts[0];
  if (!/^\d{4}$/.test(year)) return null;
  const month = parts[1] ? parseMonth(parts[1]) : null;
  const day = parts[2] && /^\d{1,2}$/.test(parts[2]) ? parts[2].padStart(2, '0') : null;
  if (month && day) return `${year}-${month}-${day}`;
  if (month) return `${year}-${month}`;
  return year;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseMonth(raw: string): string | null {
  const key = raw.slice(0, 3).toLowerCase();
  return MONTHS[key] ?? null;
}
