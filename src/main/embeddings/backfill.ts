/**
 * One-time embedding backfill (#836).
 *
 * The incremental indexer (#835) keeps embeddings current going forward, but an
 * existing thoughtbase — or one where the model just changed — needs a one-time
 * pass to embed everything. This walks every note and `indexNote`s the ones not
 * already embedded under the current model.
 *
 * Properties the issue asks for, all of which fall out of #835's design:
 *  - **Non-blocking**: embedding runs in the off-thread worker; the walk awaits
 *    per note, yielding the event loop so the UI stays responsive.
 *  - **Resumable**: the skip set is `embeddedNotePaths` (paths with current-model
 *    rows), so an interrupted run continues from what's missing on re-run.
 *  - **Model-change aware**: a new model leaves no current-model rows, so every
 *    note is reprocessed; `indexNote` clears each note's stale rows as it goes.
 *  - **Cheap no-op**: once everything's embedded, a re-run skips every note.
 *  - **Force** (manual rebuild): `clear` first, then embed all.
 *
 * A per-project registry guarantees one run at a time and lets project-close
 * abort an in-flight backfill.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectContext } from '../project-context-types';
import { isIndexable } from '../notebase/indexable-files';
import * as store from './vector-store';

export interface BackfillProgress {
  done: number;
  total: number;
  /** false once the run finishes (success, abort, or error). */
  running: boolean;
}

export interface BackfillResult {
  embedded: number;
  skipped: number;
  aborted: boolean;
}

export interface BackfillOptions {
  /** Wipe + re-embed everything (manual rebuild / suspected corruption). */
  force?: boolean;
  /** Progress callback, fired per note plus a final `running: false`. */
  onProgress?: (p: BackfillProgress) => void;
  /** Override the note walker (tests). */
  listNotes?: (rootPath: string) => Promise<string[]>;
}

const running = new Map<string, AbortController>();

/** True while a backfill is in flight for this project. */
export function isBackfilling(rootPath: string): boolean {
  return running.has(rootPath);
}

/** Abort an in-flight backfill (e.g. the project's last window closed). */
export function abortBackfill(rootPath: string): void {
  running.get(rootPath)?.abort();
  running.delete(rootPath);
}

/**
 * Run the backfill for a project. If one is already running, returns
 * immediately (no double-run). No-op when the vector store isn't enabled.
 */
export async function runBackfill(ctx: ProjectContext, opts: BackfillOptions = {}): Promise<BackfillResult> {
  if (running.has(ctx.rootPath)) return { embedded: 0, skipped: 0, aborted: false };
  if (!store.isEnabled(ctx)) return { embedded: 0, skipped: 0, aborted: false };

  const controller = new AbortController();
  running.set(ctx.rootPath, controller);
  const signal = controller.signal;
  try {
    if (opts.force) await store.clear(ctx);

    const notes = await (opts.listNotes ?? listMarkdownNotes)(ctx.rootPath);
    const alreadyDone = opts.force ? new Set<string>() : await store.embeddedNotePaths(ctx);
    const pending = notes.filter((p) => !alreadyDone.has(p));
    const total = pending.length;

    let done = 0;
    let embedded = 0;
    emit(opts, { done, total, running: true });
    for (const rel of pending) {
      if (signal.aborted) return { embedded, skipped: total - done, aborted: true };
      try {
        const content = await fs.readFile(path.join(ctx.rootPath, rel), 'utf-8');
        await store.indexNote(ctx, rel, content);
        embedded++;
      } catch (err) {
        // A single unreadable / oversized note must not abort the whole pass.
        console.warn(`[backfill] skipped ${rel}:`, err);
      }
      done++;
      emit(opts, { done, total, running: true });
    }
    return { embedded, skipped: notes.length - total, aborted: false };
  } finally {
    running.delete(ctx.rootPath);
    // Final tick so listeners can clear the indicator.
    emit(opts, { done: 0, total: 0, running: false });
  }
}

function emit(opts: BackfillOptions, p: BackfillProgress): void {
  try { opts.onProgress?.(p); } catch { /* a listener throwing must not derail the walk */ }
}

/** Default walker: every indexable markdown note under the root, skipping
 *  hidden + ignored dirs. Mirrors the registerAllCsvs / graph walkers. */
async function listMarkdownNotes(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const rel = path.relative(rootPath, full);
        if (isIndexable(rel)) out.push(rel);
      }
    }
  }
  await walk(rootPath);
  return out;
}
