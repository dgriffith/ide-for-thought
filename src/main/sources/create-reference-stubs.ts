/**
 * Materialise approved reference candidates into stub Source nodes
 * (#106). Called after the renderer's "Approve N references" dialog
 * fires — never speculatively, since stubs are user-confirmed graph
 * mutations.
 *
 * Each accepted ParsedReference becomes a source folder at
 * `.minerva/sources/<canonical-id>/meta.ttl` with:
 *   - dc:title / dc:creator / dc:issued / schema:inContainer from
 *     the LLM's parse
 *   - bibo:doi / bibo:isbn / bibo:uri when present
 *   - thought:stubStatus "unresolved" — distinguishes stubs from
 *     fully-ingested sources in the SourceDetail UI and in queries
 *   - thought:rawReference "<citation text>" — kept so the resolve
 *     step (#107) can re-parse if needed
 *
 * The parent source's meta.ttl gains a `minerva:references <stub>`
 * triple per accepted reference. Both files are re-indexed so the
 * graph picks up the new shape immediately.
 *
 * Dedup: when the canonical id of a parsed reference matches an
 * existing source (full or stub), we skip creating it and just add
 * the references edge — same canonical-id rules as the rest of the
 * ingest pipeline (#90).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalSourceId } from './source-id';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import type { ParsedReference } from './mine-references';

export interface CreateStubsResult {
  /** Stubs newly created on disk. */
  created: { sourceId: string; title: string }[];
  /** Parsed references whose canonical id already existed; the
   *  parent source still got a `minerva:references` edge to them. */
  matchedExisting: { sourceId: string; title: string }[];
  /** Parsed references that couldn't be materialised (e.g. canonical
   *  id collision with an unrelated row). */
  skipped: { reason: string; raw: string }[];
}

export async function createReferenceStubs(
  rootPath: string,
  parentSourceId: string,
  refs: readonly ParsedReference[],
): Promise<CreateStubsResult> {
  const parentDir = path.join(rootPath, '.minerva', 'sources', parentSourceId);
  const parentMetaPath = path.join(parentDir, 'meta.ttl');
  let parentTtl: string;
  try {
    parentTtl = await fs.readFile(parentMetaPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Parent source "${parentSourceId}" has no meta.ttl.`, { cause: err });
    }
    throw err;
  }

  const created: CreateStubsResult['created'] = [];
  const matchedExisting: CreateStubsResult['matchedExisting'] = [];
  const skipped: CreateStubsResult['skipped'] = [];
  const referencesEdges: string[] = [];

  const sourcesRoot = path.join(rootPath, '.minerva', 'sources');

  for (const ref of refs) {
    let canonical;
    try {
      canonical = canonicalSourceId(
        {
          doi: ref.doi ?? undefined,
          arxiv: ref.arxiv ?? undefined,
          pubmed: ref.pubmed ?? undefined,
          isbn: ref.isbn ?? undefined,
          url: ref.url ?? undefined,
        },
        // Content-hash seed: title + first author + year is stable
        // enough that re-mining the same source yields the same id.
        `${ref.title}|${ref.authors[0] ?? ''}|${ref.year ?? ''}`,
      );
    } catch (err) {
      skipped.push({ reason: err instanceof Error ? err.message : String(err), raw: ref.raw });
      continue;
    }

    const stubId = canonical.id;
    const stubDir = path.join(sourcesRoot, stubId);
    const stubMetaPath = path.join(stubDir, 'meta.ttl');
    referencesEdges.push(stubId);

    // Existence check. If a meta.ttl already lives at this canonical
    // id, treat it as a match — the parent will still get the edge,
    // and we don't overwrite the existing file (it might be a
    // resolved source the user has been hand-editing).
    let exists = false;
    try { await fs.access(stubMetaPath); exists = true; } catch { /* fresh */ }
    if (exists) {
      matchedExisting.push({ sourceId: stubId, title: ref.title });
      continue;
    }

    await fs.mkdir(stubDir, { recursive: true });
    await fs.writeFile(stubMetaPath, buildStubMetaTtl(ref), 'utf-8');
    created.push({ sourceId: stubId, title: ref.title });
    // Re-index immediately so the stub surfaces in queries before
    // the file watcher catches up.
    const ctx = projectContext(rootPath);
    graph.indexSource(ctx, stubId, await fs.readFile(stubMetaPath, 'utf-8'));
  }

  // Add minerva:references edges to parent. We use the same
  // upsert-single-valued helper as readStatus to add one line per
  // edge — except the predicate is multi-valued, so we need a
  // dedicated "append if missing" pass instead of replace-in-place.
  if (referencesEdges.length > 0) {
    const next = appendReferencesEdges(parentTtl, referencesEdges);
    if (next !== parentTtl) {
      await fs.writeFile(parentMetaPath, next, 'utf-8');
      const ctx = projectContext(rootPath);
      const body = await readBodyIfPresent(parentDir);
      graph.indexSource(ctx, parentSourceId, next, body);
    }
  }

  return { created, matchedExisting, skipped };
}

// Re-uses the on-disk shape buildMetaTtl emits, but stubs go light:
// no thought:accessedAt timestamp (the user didn't fetch this), and
// thought:stubStatus + thought:rawReference flag the partial state.
function buildStubMetaTtl(ref: ParsedReference): string {
  const lines: string[] = [`this: a thought:${ref.subtype} ;`];
  lines.push(`    dc:title ${ttlString(ref.title)} ;`);
  for (const c of ref.authors) lines.push(`    dc:creator ${ttlString(c)} ;`);
  if (ref.year) lines.push(`    dc:issued ${ttlString(ref.year)}^^xsd:gYear ;`);
  if (ref.containerTitle) lines.push(`    schema:inContainer ${ttlString(ref.containerTitle)} ;`);
  if (ref.doi) lines.push(`    bibo:doi ${ttlString(ref.doi)} ;`);
  if (ref.isbn) lines.push(`    bibo:isbn ${ttlString(ref.isbn)} ;`);
  if (ref.url) lines.push(`    bibo:uri ${ttlString(ref.url)} ;`);
  lines.push(`    thought:stubStatus ${ttlString('unresolved')} ;`);
  lines.push(`    thought:rawReference ${ttlString(ref.raw)} .`);
  return lines.join('\n') + '\n';
}

/**
 * Add `minerva:references sources:<stubId>` triples to the parent
 * source's meta.ttl, deduped against existing references edges
 * already in the file. Insertion happens immediately before the
 * closing `.` so the Turtle stays grammatical.
 *
 * Exposed for tests.
 */
export function appendReferencesEdges(parentTtl: string, stubIds: readonly string[]): string {
  const existing = collectExistingReferences(parentTtl);
  const fresh = stubIds.filter((id) => !existing.has(id));
  if (fresh.length === 0) return parentTtl;
  const lines = fresh.map((id) => `    minerva:references sources:${id} ;`);
  // Walk back to the trailing `.` and inject before it. Mirrors the
  // approach in source-merge.ts / read-status.ts.
  const trailing = parentTtl.match(/(\s*\.\s*)$/);
  if (!trailing) {
    return parentTtl + (parentTtl.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n    .\n';
  }
  const dotIdx = trailing.index ?? parentTtl.length;
  const lineStart = parentTtl.lastIndexOf('\n', dotIdx - 1);
  if (lineStart < 0) {
    return parentTtl.slice(0, dotIdx).replace(/\s+$/, ' ;') + '\n' + lines.join('\n') + '\n' + parentTtl.slice(dotIdx);
  }
  return parentTtl.slice(0, lineStart) + '\n' + lines.join('\n') + parentTtl.slice(lineStart);
}

function collectExistingReferences(ttl: string): Set<string> {
  const out = new Set<string>();
  const re = /minerva:references\s+sources:([\w.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ttl)) !== null) out.add(m[1]);
  return out;
}

async function readBodyIfPresent(dir: string): Promise<string | undefined> {
  try { return await fs.readFile(path.join(dir, 'body.md'), 'utf-8'); } catch { return undefined; }
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

