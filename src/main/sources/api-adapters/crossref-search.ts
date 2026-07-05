/**
 * CrossRef bibliographic-search adapter (#107).
 *
 * Different endpoint than `fetchCrossrefMetadata`: the search API
 * takes a free-form query and returns a ranked list of `Work`
 * records. Used by the stub-resolve path to map "Smith, J. (2024).
 * Foo bar. Journal X." → a DOI.
 *
 * Docs: https://api.crossref.org/swagger-ui/index.html#/Works/get_works
 */

import type { CrossrefWork } from './crossref';
import { CROSSREF_ENDPOINT } from './crossref';

export interface CrossrefSearchCandidate {
  /** Raw Work record CrossRef returned. */
  work: CrossrefWork;
  /** CrossRef's own relevance score (untransformed). */
  rawScore: number;
}

export interface CrossrefSearchOptions {
  rows?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Run a bibliographic search against CrossRef. `query` is whatever
 * free-form text identifies the work — typically title + author +
 * year. CrossRef's relevance ranker handles the rest.
 *
 * Returns at most `rows` candidates (default 3, matching the issue's
 * "show top 3 in a disambiguation UI" intent).
 */
export async function searchCrossrefBibliographic(
  query: string,
  opts: CrossrefSearchOptions = {},
): Promise<CrossrefSearchCandidate[]> {
  const rows = Math.max(1, Math.min(20, opts.rows ?? 3));
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = `${CROSSREF_ENDPOINT}?query.bibliographic=${encodeURIComponent(query)}&rows=${rows}`;
  const res = await fetchImpl(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Minerva/1.0 (https://minerva.dev; mailto:ingest@minerva.local)',
    },
  });
  if (!res.ok) throw new Error(`CrossRef search ${res.status}: ${res.statusText}`);
  const payload = await res.json() as { message?: { items?: (CrossrefWork & { score?: number })[] } };
  const items = payload.message?.items ?? [];
  return items.map((item) => ({
    work: item,
    rawScore: typeof item.score === 'number' ? item.score : 0,
  }));
}
