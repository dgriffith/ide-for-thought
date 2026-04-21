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

  const excerptId = `${params.sourceId}-${shortHash(cited)}`;
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
  lines.push(`    prov:generatedAtTime ${ttlString(new Date().toISOString())}^^xsd:dateTime .`);
  return lines.join('\n') + '\n';
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
