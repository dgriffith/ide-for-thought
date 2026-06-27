/**
 * Create a `thought:Excerpt` from a highlighted passage in a source body (#224).
 *
 * Writes `.minerva/excerpts/<excerpt-id>.ttl` with the predicates the
 * indexer already understands (`thought:fromSource`, `thought:citedText`,
 * optional `thought:page` / `thought:pageRange` / `thought:locationText`).
 * The chokidar watcher picks the new file up and reindexes automatically.
 *
 * Excerpt id shape: `<sourceId>-<12-hex-short-hash-of-citedText>`. This
 * clusters excerpts by source in filesystem listings AND makes re-saving
 * the identical passage idempotent — same text → same id → we either
 * skip or update in place.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface CreateExcerptParams {
  sourceId: string;
  citedText: string;
  /** Optional page / page-range / location annotations from the UI. */
  page?: number | null;
  pageRange?: string | null;
  locationText?: string | null;
  /** Optional 0-based character offsets of the cited text within the source's
   *  extracted body.md (#104). When supplied, emitted as thought:charStart /
   *  thought:charEnd so the excerpt is anchored, not just quote-matched. */
  charStart?: number | null;
  charEnd?: number | null;
}

export interface CreateExcerptResult {
  excerptId: string;
  relativePath: string;
  /** True when the file already existed (idempotent re-save). */
  duplicate: boolean;
}

export async function createExcerpt(
  rootPath: string,
  params: CreateExcerptParams,
): Promise<CreateExcerptResult> {
  const cited = params.citedText.trim();
  if (!cited) throw new Error('Empty selection; nothing to excerpt.');
  if (!params.sourceId) throw new Error('Missing sourceId.');

  const excerptId = excerptIdFor(params.sourceId, cited);
  const relativePath = `.minerva/excerpts/${excerptId}.ttl`;
  const absPath = path.join(rootPath, relativePath);

  let duplicate = false;
  try {
    await fs.access(absPath);
    duplicate = true;
  } catch { /* not there yet */ }

  if (!duplicate) {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buildExcerptTtl(params), 'utf-8');
  }

  return { excerptId, relativePath, duplicate };
}

export function buildExcerptTtl(params: CreateExcerptParams): string {
  const lines: string[] = [
    'this: a thought:Excerpt ;',
    `    thought:fromSource sources:${params.sourceId} ;`,
    `    thought:citedText ${ttlString(params.citedText.trim())} ;`,
  ];
  if (params.page != null) {
    lines.push(`    thought:page ${params.page} ;`);
  }
  if (params.pageRange) {
    lines.push(`    thought:pageRange ${ttlString(params.pageRange)} ;`);
  }
  if (params.locationText) {
    lines.push(`    thought:locationText ${ttlString(params.locationText)} ;`);
  }
  if (params.charStart != null && params.charEnd != null) {
    lines.push(`    thought:charStart ${params.charStart} ;`);
    lines.push(`    thought:charEnd ${params.charEnd} ;`);
  }
  lines.push(`    prov:generatedAtTime ${ttlString(new Date().toISOString())}^^xsd:dateTime .`);
  return lines.join('\n') + '\n';
}

/** Deterministic excerpt id for a (source, citedText) pair. Exposed so callers
 *  that need the id before/without writing the file (e.g. the claim-extraction
 *  draft, #104) compute the same id `createExcerpt` would. */
export function excerptIdFor(sourceId: string, citedText: string): string {
  return `${sourceId}-${shortHash(citedText.trim())}`;
}

/**
 * Pull `thought:citedText` back out of an excerpt's TTL (the inverse of
 * `ttlString`), for embedding the excerpt (#839). Returns null if absent.
 */
export function citedTextFromTtl(ttl: string): string | null {
  const m = ttl.match(/thought:citedText\s+"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  return m[1]
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function ttlString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** 12-hex-char sha256 prefix. Same strategy as source-id.ts. */
function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}
