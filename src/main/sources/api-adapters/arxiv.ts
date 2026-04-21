/**
 * arXiv API adapter.
 *
 * Docs: https://info.arxiv.org/help/api/index.html
 *
 * The response is Atom XML, one `<entry>` per id. We parse it with
 * linkedom's DOMParser (no new deps), pick off the fields we need, and
 * derive a fetchable PDF URL from the `<link rel="related">` element.
 */

import { DOMParser } from 'linkedom';
import type { ArticleMetadata } from './types';

export const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query';

export async function fetchArxivMetadata(
  arxivId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ArticleMetadata> {
  const url = `${ARXIV_ENDPOINT}?id_list=${encodeURIComponent(arxivId)}`;
  const res = await fetchImpl(url, {
    headers: { 'Accept': 'application/atom+xml' },
  });
  if (!res.ok) throw new Error(`arXiv ${res.status}: ${res.statusText}`);
  const xml = await res.text();
  return parseArxivAtom(xml, arxivId);
}

export function parseArxivAtom(xml: string, arxivId: string): ArticleMetadata {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const entry = doc.querySelector('entry');
  if (!entry) throw new Error(`arXiv: no <entry> in response for ${arxivId}`);

  const title = textOf(entry, 'title') || '(untitled)';
  const abstract = textOf(entry, 'summary') || null;
  const creators: string[] = [];
  for (const a of entry.querySelectorAll('author')) {
    const name = textOf(a, 'name');
    if (name) creators.push(name);
  }
  const published = textOf(entry, 'published');
  const issued = published ? published.slice(0, 10) : null; // YYYY-MM-DD

  // arXiv embeds a DOI in a namespaced element when the paper has one.
  let doi: string | null = null;
  const doiEl = entry.getElementsByTagName('arxiv:doi')[0]
    ?? entry.getElementsByTagName('doi')[0];
  if (doiEl) doi = (doiEl.textContent ?? '').trim() || null;

  // Category: prefer the primary_category `term` attribute.
  let category: string | null = null;
  const primary = entry.getElementsByTagName('arxiv:primary_category')[0]
    ?? entry.querySelector('primary_category')
    ?? entry.querySelector('category');
  if (primary) category = primary.getAttribute('term') || null;

  // Find the PDF link — arXiv advertises it as rel="related" type="application/pdf".
  let pdfUrl: string | null = null;
  for (const link of entry.querySelectorAll('link')) {
    if (link.getAttribute('type') === 'application/pdf') {
      pdfUrl = link.getAttribute('href');
      break;
    }
  }
  // The canonical abstract-page URL comes via rel="alternate".
  let uri: string | null = null;
  for (const link of entry.querySelectorAll('link')) {
    if (link.getAttribute('rel') === 'alternate') {
      uri = link.getAttribute('href');
      break;
    }
  }
  if (!uri) uri = `https://arxiv.org/abs/${arxivId}`;

  const journalRef = entry.getElementsByTagName('arxiv:journal_ref')[0]
    ?? entry.querySelector('journal_ref');
  const containerTitle = journalRef?.textContent?.trim() || null;

  return {
    subtype: 'Preprint',
    title: title.replace(/\s+/g, ' '),
    creators,
    abstract: abstract ? abstract.replace(/\s+/g, ' ').trim() : null,
    issued,
    publisher: 'arXiv',
    containerTitle,
    doi,
    isbn: null,
    arxiv: arxivId,
    pubmed: null,
    uri,
    pdfUrl,
    category,
  };
}

function textOf(el: Element, selector: string): string {
  const child = el.querySelector(selector);
  return child?.textContent?.trim() ?? '';
}
