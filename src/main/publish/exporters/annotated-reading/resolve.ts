/**
 * Resolve everything that goes into an annotated-reading bundle for
 * a given source (#253):
 *
 *   - the source body markdown
 *   - every excerpt whose `thought:fromSource` points at the source,
 *     with their cited text + page locator + tags
 *   - every project note that wiki-links to the source or to one of
 *     its excerpts (split into "via excerpt" and "general/related"
 *     so the renderer can place them in the right margin slot)
 *
 * Lives separate from the renderer so the resolution logic is
 * testable without spinning up markdown-it.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { extractWikiLinkTargets } from '../../tree-resolver';
import { excerptTtlToInfo } from '../../csl/source-to-csl';
import { scanCitations } from '../../../bibliography/scan-citations';
// Path is `src/main/publish/exporters/annotated-reading/resolve.ts` →
// `src/main/bibliography/scan-citations.ts`: ../../../bibliography/.
import type { ExportPlanFile } from '../../types';

export interface AnnotatedExcerpt {
  id: string;
  /** The exact quoted passage from the source body. */
  citedText: string;
  /** "11", "97-98", or empty when no page info attached. */
  locator: string;
  /** Tags pulled from a free-form `thought:hasTag` predicate, if any. */
  tags: string[];
  /** Notes that wiki-link to this excerpt id specifically. */
  linkedNotes: Array<{ relativePath: string; title: string }>;
}

export interface AnnotatedReadingData {
  sourceId: string;
  sourceBody: string;
  /** Excerpts keyed-and-ordered by document position in the source body when alignable, else trailing. */
  excerpts: AnnotatedExcerpt[];
  /** Notes that link to the source (or to any excerpt) but don't anchor to a specific excerpt. */
  relatedNotes: Array<{ relativePath: string; title: string }>;
}

/**
 * Walk the project for every annotation pointing at the given source,
 * read each into memory, and return the consolidated bundle.
 *
 * `notes` is the slice of the project's note files we should consult
 * for inbound links — typically `plan.inputs.filter(kind === 'note')`,
 * but the exporter passes its own filtered list (private notes
 * already excluded by `resolvePlan`).
 */
export async function resolveAnnotatedReading(
  rootPath: string,
  sourceId: string,
  sourceBody: string,
  notes: ExportPlanFile[],
): Promise<AnnotatedReadingData> {
  // 1. Excerpts pointing at this source.
  const excerptsDir = path.join(rootPath, '.minerva', 'excerpts');
  let excerptFiles: Array<{ name: string; isFile: () => boolean }>;
  try {
    excerptFiles = await fs.readdir(excerptsDir, { withFileTypes: true });
  } catch {
    excerptFiles = [];
  }
  const excerpts: AnnotatedExcerpt[] = [];
  for (const entry of excerptFiles) {
    if (!entry.isFile() || !entry.name.endsWith('.ttl')) continue;
    const id = entry.name.replace(/\.ttl$/, '');
    let ttl: string;
    try { ttl = await fs.readFile(path.join(excerptsDir, entry.name), 'utf-8'); } catch { continue; }
    const info = excerptTtlToInfo(ttl, id);
    if (!info || info.sourceId !== sourceId) continue;
    excerpts.push({
      id,
      citedText: info.citedText ?? '',
      locator: info.locator ?? '',
      tags: extractTagsFromTtl(ttl),
      linkedNotes: [],
    });
  }

  // 2. Walk the project notes for inbound wiki-links to the source
  //    or to any of the excerpts. A link to the source itself ends up
  //    in `relatedNotes`; a link to a specific excerpt attaches to
  //    that excerpt's `linkedNotes`.
  const excerptIds = new Set(excerpts.map((e) => e.id));
  const relatedNotes: Array<{ relativePath: string; title: string }> = [];
  const seenRelated = new Set<string>();
  const excerptIndex = new Map(excerpts.map((e) => [e.id, e]));

  for (const note of notes) {
    if (note.kind !== 'note') continue;
    // Plain wiki-link targets (excludes cite/quote — those return
    // their own kind from scanCitations below).
    const plain = extractWikiLinkTargets(note.content);
    // Cite/quote refs need scanCitations since the tree resolver
    // deliberately skips them.
    const cites = scanCitations(note.content);

    let linksToSource = false;
    const linkedExcerptIds = new Set<string>();
    for (const t of plain) {
      if (t === sourceId) linksToSource = true;
      // A bare `[[<excerpt-id>]]` would be unusual but technically
      // valid; treat it the same as a quote.
      if (excerptIds.has(t)) linkedExcerptIds.add(t);
    }
    for (const ref of cites) {
      if (ref.kind === 'cite' && ref.id === sourceId) linksToSource = true;
      if (ref.kind === 'quote' && excerptIds.has(ref.id)) linkedExcerptIds.add(ref.id);
    }
    for (const id of linkedExcerptIds) {
      const ex = excerptIndex.get(id);
      if (ex) ex.linkedNotes.push({ relativePath: note.relativePath, title: note.title });
    }
    if (linksToSource && !seenRelated.has(note.relativePath)) {
      relatedNotes.push({ relativePath: note.relativePath, title: note.title });
      seenRelated.add(note.relativePath);
    }
  }

  return { sourceId, sourceBody, excerpts, relatedNotes };
}

/**
 * Pull `thought:hasTag "value"` literals out of an excerpt TTL — the
 * same predicate the indexer uses for free-form tag attachment on
 * excerpts. Narrow regex; the full TTL parse would be overkill.
 */
function extractTagsFromTtl(ttl: string): string[] {
  const out: string[] = [];
  const re = /thought:hasTag\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ttl)) !== null) out.push(m[1].trim());
  return out;
}
