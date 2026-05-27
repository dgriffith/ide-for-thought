/**
 * Promote a reference stub (#106) to a fully-resolved source (#107).
 *
 *   1. Read the stub's current metadata + raw citation text.
 *   2. CrossRef bibliographic search → top-N candidates with scores.
 *   3. Normalise the scores into a 0-1 confidence per candidate
 *      using title-overlap + author-overlap + year-match heuristics
 *      on top of CrossRef's own relevance number.
 *   4. The renderer surfaces the top 3 (or auto-applies the top one
 *      when its confidence clears the auto-threshold).
 *   5. On user pick: `applyStubResolution` fetches the full Work
 *      record via the existing identifier adapter, rewrites the
 *      stub's meta.ttl with the canonical metadata, and flips
 *      `thought:stubStatus` to "resolved".
 *
 * Scope note: this PR enriches the stub in place. The canonical
 * source id keeps the stub's content-hash form (`sha-xxx`); a
 * follow-up will add the rename + cite-link rewrite when the new
 * DOI implies a better id. The user can rename manually today via
 * the existing rename-source command.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Parser } from 'n3';
import { searchCrossrefBibliographic, type CrossrefSearchCandidate } from './api-adapters/crossref-search';
import { parseCrossrefWork } from './api-adapters/crossref';
import { fetchCrossrefMetadata } from './api-adapters/crossref';
import { buildMetaTtl } from './ingest-identifier';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';

export interface StubMetaSnapshot {
  title: string;
  authors: string[];
  year: string | null;
  /** Raw citation text — what the LLM extracted from body.md (#106). */
  rawReference: string | null;
}

import type { ResolveCandidate } from '../../shared/resolve-stub';
export type { ResolveCandidate } from '../../shared/resolve-stub';

export interface ResolveOptions {
  fetchImpl?: typeof fetch;
  /** Override threshold for "auto-pick the top candidate without
   *  showing the picker". Default 0.85 (mirrors
   *  RESOLVE_AUTO_THRESHOLD) — the issue's intent: high-confidence
   *  matches don't pester the user. */
  autoThreshold?: number;
}

const META_TTL_PREAMBLE =
  '@prefix this: <https://minerva.dev/this/> .\n' +
  '@prefix dc: <http://purl.org/dc/terms/> .\n' +
  '@prefix bibo: <http://purl.org/ontology/bibo/> .\n' +
  '@prefix schema: <http://schema.org/> .\n' +
  '@prefix thought: <https://minerva.dev/ontology/thought#> .\n' +
  '@prefix minerva: <https://minerva.dev/ontology#> .\n' +
  '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n';

const DC = 'http://purl.org/dc/terms/';
const THOUGHT = 'https://minerva.dev/ontology/thought#';

/**
 * Read a source's stub fields from its meta.ttl. Used to build the
 * search query against CrossRef. Exposed for tests.
 */
export function parseStubMeta(metaTtl: string): StubMetaSnapshot {
  const quads = new Parser().parse(META_TTL_PREAMBLE + metaTtl);
  let title = '';
  let year: string | null = null;
  let rawReference: string | null = null;
  const authors: string[] = [];
  for (const q of quads) {
    const p = q.predicate.value;
    const v = q.object.value;
    if (p === `${DC}title` && !title) title = v;
    else if (p === `${DC}creator`) authors.push(v);
    else if (p === `${DC}issued` && /^\d{4}/.test(v) && !year) year = v.slice(0, 4);
    else if (p === `${THOUGHT}rawReference` && !rawReference) rawReference = v;
  }
  return { title, authors, year, rawReference };
}

/**
 * Resolve a stub by issuing a CrossRef bibliographic search and
 * scoring the candidates. Returns the top-N matches ordered by
 * confidence desc.
 */
export async function resolveStub(
  rootPath: string,
  sourceId: string,
  opts: ResolveOptions = {},
): Promise<ResolveCandidate[]> {
  const metaPath = path.join(rootPath, '.minerva', 'sources', sourceId, 'meta.ttl');
  let metaTtl: string;
  try {
    metaTtl = await fs.readFile(metaPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Source "${sourceId}" not found.`, { cause: err });
    }
    throw err;
  }
  const stub = parseStubMeta(metaTtl);
  if (!stub.title && !stub.rawReference) {
    throw new Error('Stub has no title or raw citation text to search by.');
  }

  const query = buildSearchQuery(stub);
  const raw = await searchCrossrefBibliographic(query, {
    fetchImpl: opts.fetchImpl,
    rows: 5,
  });
  const candidates = raw
    .map((c) => scoreCandidate(c, stub))
    .filter((c): c is ResolveCandidate => c !== null);
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, 3);
}

/**
 * Fetch the chosen DOI's full metadata and rewrite the source's
 * meta.ttl in place, flipping `thought:stubStatus` from
 * `"unresolved"` to `"resolved"`. The source id stays the same.
 *
 * Returns true on success, false when the DOI fetch failed and no
 * change was made.
 */
export async function applyStubResolution(
  rootPath: string,
  sourceId: string,
  doi: string,
  opts: ResolveOptions = {},
): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  // Pull full metadata. If this fails, leave the stub untouched.
  const metadata = await fetchCrossrefMetadata(doi, fetchImpl);
  // Use the existing builder; mark as resolved.
  const baseTtl = buildMetaTtl(metadata).replace(
    /(\s+\.\s*)$/,
    ` ;\n    thought:stubStatus "resolved" ;\n    thought:resolvedFrom "stub"$1`,
  );

  const metaPath = path.join(rootPath, '.minerva', 'sources', sourceId, 'meta.ttl');
  await fs.writeFile(metaPath, baseTtl, 'utf-8');

  // Re-index so the graph picks up the new title / DOI / etc.
  const ctx = projectContext(rootPath);
  let body: string | undefined;
  try { body = await fs.readFile(path.join(rootPath, '.minerva', 'sources', sourceId, 'body.md'), 'utf-8'); } catch { /* ok */ }
  graph.indexSource(ctx, sourceId, baseTtl, body);
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildSearchQuery(stub: StubMetaSnapshot): string {
  // Prefer raw bibliographic text when we have it — CrossRef's own
  // relevance handles arbitrary citation strings well. Falls back to
  // the structured fields the LLM extracted.
  if (stub.rawReference && stub.rawReference.length > 20) {
    return stub.rawReference.slice(0, 400);
  }
  const parts: string[] = [];
  if (stub.title) parts.push(stub.title);
  if (stub.authors[0]) parts.push(stub.authors[0]);
  if (stub.year) parts.push(stub.year);
  return parts.join(' ');
}

/**
 * Convert a CrossRef hit into a `ResolveCandidate` with a 0–1
 * confidence + plain-English breakdown. Returns null when the hit
 * has no DOI (we won't surface unrecoverable candidates).
 *
 * Scoring uses three signals, weighted:
 *   - Title overlap: token-set Jaccard between stub.title and
 *     candidate.title.
 *   - Author overlap: did the stub's first author surface in the
 *     candidate's authors?
 *   - Year match: does the candidate's `issued` year match the
 *     stub's?
 *
 * CrossRef's own `score` is highly variable across queries so we
 * don't normalise it; we use the *order* it implies (top-N) and
 * compute our own confidence on top.
 *
 * Exposed for tests.
 */
export function scoreCandidate(
  hit: CrossrefSearchCandidate,
  stub: StubMetaSnapshot,
): ResolveCandidate | null {
  if (!hit.work.DOI) return null;
  const parsed = parseCrossrefWork(hit.work, hit.work.DOI);
  const reasons: string[] = [];

  // Title overlap (60% weight).
  const titleScore = stub.title
    ? titleOverlap(stub.title, parsed.title)
    : 0;
  if (titleScore > 0.6) reasons.push('strong title match');
  else if (titleScore > 0.3) reasons.push('partial title match');
  else reasons.push('weak title match');

  // Author overlap (25% weight). Compare last-names normalised.
  const stubAuthorTokens = stub.authors.flatMap(lastNameTokens);
  const parsedAuthorTokens = new Set(parsed.creators.flatMap(lastNameTokens));
  const authorOverlap = stubAuthorTokens.length === 0
    ? 0
    : stubAuthorTokens.filter((t) => parsedAuthorTokens.has(t)).length / stubAuthorTokens.length;
  if (authorOverlap >= 1 && stubAuthorTokens.length > 0) reasons.push('every author in common');
  else if (authorOverlap > 0) reasons.push(`${Math.round(authorOverlap * stubAuthorTokens.length)} author(s) in common`);
  else if (stubAuthorTokens.length > 0) reasons.push('no shared author names');

  // Year match (15% weight). Hard zero / one.
  const yearMatch = stub.year && parsed.issued && stub.year === parsed.issued.slice(0, 4) ? 1 : 0;
  if (stub.year && parsed.issued) {
    reasons.push(yearMatch === 1 ? 'year match' : `year off (${stub.year} vs ${parsed.issued.slice(0, 4)})`);
  }

  // Weights: title is the strongest signal, but a year mismatch
  // should drop below the auto-apply threshold even with a perfect
  // title + authors (two papers with the same title in different
  // years are usually distinct works).
  const confidence = clamp01(
    0.55 * titleScore +
    0.20 * authorOverlap +
    0.25 * yearMatch,
  );

  return {
    doi: hit.work.DOI,
    title: parsed.title,
    authors: parsed.creators,
    year: parsed.issued ? parsed.issued.slice(0, 4) : null,
    containerTitle: parsed.containerTitle,
    confidence,
    reasoning: reasons.join(' · '),
  };
}

/**
 * Title-overlap metric: intersection / size-of-shorter-set. Recall
 * against the shorter side, which is the right question here: the
 * stub's title is often abbreviated (the LLM extracted a few key
 * words), while CrossRef stores the full publisher title with
 * subtitle. A symmetric Jaccard would unfairly penalise that.
 */
function titleOverlap(a: string, b: string): number {
  const aTokens = new Set(tokenise(a));
  const bTokens = new Set(tokenise(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const t of aTokens) if (bTokens.has(t)) intersection++;
  return intersection / Math.min(aTokens.size, bTokens.size);
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'the',
  'with', 'from', 'by', 'at', 'as', 'is', 'are',
]);

function tokenise(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function lastNameTokens(name: string): string[] {
  // "Smith, J." → "smith"; "Jane Smith" → "smith". Best-effort.
  const stripped = name.split(',')[0].trim();
  const last = stripped.split(/\s+/).pop() ?? '';
  return last ? [last.toLowerCase().replace(/[^a-z]/g, '')] : [];
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export { RESOLVE_AUTO_THRESHOLD } from '../../shared/resolve-stub';
