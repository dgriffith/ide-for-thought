/**
 * Which stored vector rows a re-index actually has to rewrite (#2217).
 *
 * The vector store's *embedding* side has always been incremental — a chunk
 * whose sha256 is already on disk never reaches the model. Its *persistence*
 * side was not: `indexChunks` deleted every row for the ref and re-inserted all
 * of them, unchanged ones included. Measured on a 60-section note with one word
 * edited: 61 rows deleted, 61 re-inserted, and a 191 KB `INSERT … VALUES` string
 * for the one row that actually differed — once per second, for as long as the
 * user keeps typing (`AUTO_SAVE_DELAY = 1000`).
 *
 * This module is the correctness-critical half of the fix, kept pure and away
 * from DuckDB so it can be tested exhaustively without a database. The hazard
 * it exists to get right is `chunk_index` drift: a row's identity in the table
 * is `(kind, ref_id, chunk_index)`, and inserting a section near the top shifts
 * every later chunk's index by one. A diff that matched rows by `content_hash`
 * alone would see "all these hashes are still present", write nothing, and
 * leave every row sitting at the wrong index — and, worse, would leave a
 * *deleted* chunk's row behind forever as a phantom search hit. So the diff is
 * keyed on `chunk_index` and compares the whole stored tuple.
 */

import type { Chunk } from './chunk';

/** The identifying columns of one stored row, as read back from the table. */
export interface StoredRow {
  /** `chunk_index` — this row's identity within its (kind, ref). */
  index: number;
  /** `section_heading` — the breadcrumb. */
  heading: string;
  /** `content_hash` — sha256 of the chunk's own text. */
  hash: string;
  /** `embedding_model` — which model produced this row's vector. */
  model: string;
}

export interface RowDiff {
  /** `chunk_index` values whose stored row must be deleted. Includes the
   *  indexes in `write` (delete-then-insert), plus any index past the end of
   *  the new chunk list. Empty when `fullReplace` is set. */
  deleteIndexes: number[];
  /** Chunks whose row must be written. A chunk here still may not need a fresh
   *  *vector* — the caller reuses one by hash where it can. */
  write: Chunk[];
  /** Give up on the incremental path and delete every row for the ref instead.
   *  See the duplicate-index note below. */
  fullReplace: boolean;
}

/**
 * Plan the minimal set of row writes that makes the table match `chunks`.
 *
 * Invariant this must satisfy, and the one `vector-store.test.ts` round-trips:
 * applying the plan leaves *exactly* the rows a from-scratch reindex would have
 * written. Everything below follows from that.
 */
export function planRowDiff(
  chunks: readonly Chunk[],
  stored: readonly StoredRow[],
  model: string,
): RowDiff {
  const byIndex = new Map<number, StoredRow>();
  for (const row of stored) {
    if (byIndex.has(row.index)) {
      // Two rows share a `chunk_index`. The incremental path keys its DELETE on
      // `chunk_index`, so it would remove one of them and silently leave the
      // other behind — a row nothing will ever update again, matching searches
      // forever. This module's own writes can't produce it (one row per index,
      // every time), but a store written by an older build, a half-applied
      // transaction, or a hand-edited DB is not ours to trust. Fall back to the
      // pre-#2217 full replace, which is correct from *any* prior state.
      return { deleteIndexes: [], write: [...chunks], fullReplace: true };
    }
    byIndex.set(row.index, row);
  }

  const keep = new Set<number>();
  const write: Chunk[] = [];
  for (const chunk of chunks) {
    const row = byIndex.get(chunk.index);
    // A stored row survives only when EVERY column this module writes still
    // matches. Each of the four is load-bearing:
    //
    //  - index      — already matched, by construction of the lookup.
    //  - hash       — sha256 of `chunk.text`, so it also pins `chunk_text`.
    //  - heading    — NOT implied by the hash, and this is the subtle one.
    //                 `section_heading` is a *breadcrumb* built from the whole
    //                 ancestor stack, while the hash only covers this chunk's
    //                 own text. Rename an H1 and every H2 beneath it keeps a
    //                 byte-identical body, an identical hash, and a stale
    //                 breadcrumb — the string shown beside every search hit.
    //                 (Same for the 2nd+ sub-chunk of an over-long section,
    //                 which doesn't carry its own heading line at all.)
    //  - model      — a vector produced by a different embedding model is not
    //                 comparable to the current one. Deliberately re-checked
    //                 here rather than filtered out of the read, so a
    //                 stale-model row is *visible* to the diff and gets deleted
    //                 rather than lingering under the new model's rows.
    if (row && row.hash === chunk.hash && row.heading === chunk.heading && row.model === model) {
      keep.add(chunk.index);
    } else {
      write.push(chunk);
    }
  }

  // Everything stored that isn't being kept goes: the indexes we're about to
  // rewrite (delete-then-insert keeps `insertRows` a plain INSERT rather than
  // an UPSERT, and the table has no key to upsert on) and — the case a
  // hash-keyed diff would miss — every index past the end of a note that got
  // shorter.
  const deleteIndexes: number[] = [];
  for (const index of byIndex.keys()) if (!keep.has(index)) deleteIndexes.push(index);

  return { deleteIndexes, write, fullReplace: false };
}
