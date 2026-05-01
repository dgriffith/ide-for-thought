/**
 * Citation audit for the export-preview dialog (#301).
 *
 * Walks every note in the resolved plan, scans for `[[cite::id]]` and
 * `[[quote::id]]` references, groups them by their resolved source, and
 * surfaces the counts + any missing ids so the preview UI can show the
 * user exactly what'll be cited before they hit Export.
 *
 * Lives next to the rest of the citation engine because the audit
 * needs the same `CitationAssets` map that powers the renderer — the
 * audit answers "which sources will the renderer actually find" and
 * "which won't it find," so the data has to come from the same source
 * of truth.
 */

import type { CitationAssets } from './index';
import { scanCitations } from '../../bibliography/scan-citations';

export interface CitationAuditEntry {
  sourceId: string;
  /** Display title pulled from the loaded CSL item, or the bare id when unavailable. */
  title: string;
  /** Total inline references that resolve to this source — cites + quotes summed. */
  refCount: number;
}

export interface CitationAuditMissing {
  /** The id as written in the markdown (`cite::brooks-1986` → `brooks-1986`). */
  id: string;
  kind: 'cite' | 'quote';
  refCount: number;
}

export interface CitationAudit {
  /** Sources that'll appear in the rendered bibliography, ordered by reference count desc, then id. */
  bySource: CitationAuditEntry[];
  /** Cites/quotes whose ids couldn't be resolved against the project's sources/excerpts. */
  missing: CitationAuditMissing[];
}

/**
 * Build the audit from the plan's note contents + the loaded citation assets.
 *
 * Excerpt references resolve through `assets.excerpts` to their parent
 * source — both `[[cite::brooks-1986]]` and `[[quote::brooks-essential]]`
 * (where the excerpt's `thought:fromSource` is `brooks-1986`) count
 * against the same Brooks bucket.
 */
export function buildCitationAudit(
  notes: Array<{ relativePath: string; content: string }>,
  assets: CitationAssets,
): CitationAudit {
  const bySource = new Map<string, CitationAuditEntry>();
  const missing = new Map<string, CitationAuditMissing>();

  for (const note of notes) {
    for (const ref of scanCitations(note.content)) {
      if (ref.kind === 'quote') {
        const ex = assets.excerpts.get(ref.id);
        if (!ex) {
          bumpMissing(missing, ref.id, 'quote');
          continue;
        }
        if (!assets.items.has(ex.sourceId)) {
          // Excerpt found but its parent source is missing — surface
          // the source id so the user knows what's actually wrong.
          bumpMissing(missing, ex.sourceId, 'cite');
          continue;
        }
        bumpSource(bySource, ex.sourceId, assets);
        continue;
      }
      // kind === 'cite'
      if (!assets.items.has(ref.id)) {
        bumpMissing(missing, ref.id, 'cite');
        continue;
      }
      bumpSource(bySource, ref.id, assets);
    }
  }

  return {
    bySource: [...bySource.values()].sort((a, b) =>
      b.refCount - a.refCount || a.sourceId.localeCompare(b.sourceId),
    ),
    missing: [...missing.values()].sort((a, b) =>
      b.refCount - a.refCount || a.id.localeCompare(b.id),
    ),
  };
}

function bumpSource(
  map: Map<string, CitationAuditEntry>,
  sourceId: string,
  assets: CitationAssets,
): void {
  const existing = map.get(sourceId);
  if (existing) {
    existing.refCount += 1;
    return;
  }
  const item = assets.items.get(sourceId);
  const title = typeof item?.title === 'string' && item.title ? item.title : sourceId;
  map.set(sourceId, { sourceId, title, refCount: 1 });
}

function bumpMissing(
  map: Map<string, CitationAuditMissing>,
  id: string,
  kind: 'cite' | 'quote',
): void {
  const existing = map.get(id);
  if (existing) {
    existing.refCount += 1;
    return;
  }
  map.set(id, { id, kind, refCount: 1 });
}
