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
import { citedTextFromTtl } from '../sources/create-excerpt';
import * as store from './vector-store';
import type { RefKind } from './vector-store';

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

    const { items, skipped } = await collectWork(ctx, opts);
    const total = items.length;

    let done = 0;
    let embedded = 0;
    emit(opts, { done, total, running: true });
    for (const item of items) {
      if (signal.aborted) return { embedded, skipped: skipped + (total - done), aborted: true };
      try {
        const content = await item.load();
        await store.indexChunks(ctx, item.kind, item.ref, content);
        embedded++;
      } catch (err) {
        // A single unreadable / oversized item must not abort the whole pass.
        console.warn(`[backfill] skipped ${item.kind}:${item.ref}:`, err);
      }
      done++;
      emit(opts, { done, total, running: true });
    }
    return { embedded, skipped, aborted: false };
  } finally {
    running.delete(ctx.rootPath);
    // Final tick so listeners can clear the indicator.
    emit(opts, { done: 0, total: 0, running: false });
  }
}

function emit(opts: BackfillOptions, p: BackfillProgress): void {
  try { opts.onProgress?.(p); } catch { /* a listener throwing must not derail the walk */ }
}

interface WorkItem {
  kind: RefKind;
  ref: string;
  /** Lazily loads the text to embed (note body / source body / excerpt text). */
  load: () => Promise<string>;
}

/** Assemble the not-yet-embedded work across all three corpora (#839): notes,
 *  source bodies, and excerpts. The per-kind skip set makes this resumable +
 *  cheap on re-run; `force` clears the skip sets so everything is reprocessed. */
async function collectWork(ctx: ProjectContext, opts: BackfillOptions): Promise<{ items: WorkItem[]; skipped: number }> {
  const rootPath = ctx.rootPath;
  const notePaths = await (opts.listNotes ?? listMarkdownNotes)(rootPath);
  const sourceIds = await listSourcesWithBody(rootPath);
  const excerptIds = await listExcerptIds(rootPath);
  const candidates = notePaths.length + sourceIds.length + excerptIds.length;

  const [doneNotes, doneSources, doneExcerpts] = opts.force
    ? [new Set<string>(), new Set<string>(), new Set<string>()]
    : await Promise.all([
        store.embeddedRefs(ctx, 'note'),
        store.embeddedRefs(ctx, 'source'),
        store.embeddedRefs(ctx, 'excerpt'),
      ]);

  const items: WorkItem[] = [];
  for (const ref of notePaths) {
    if (!doneNotes.has(ref)) items.push({ kind: 'note', ref, load: () => fs.readFile(path.join(rootPath, ref), 'utf-8') });
  }
  for (const ref of sourceIds) {
    if (!doneSources.has(ref)) {
      items.push({ kind: 'source', ref, load: () => fs.readFile(path.join(rootPath, '.minerva', 'sources', ref, 'body.md'), 'utf-8') });
    }
  }
  for (const ref of excerptIds) {
    if (!doneExcerpts.has(ref)) {
      items.push({
        kind: 'excerpt', ref,
        load: async () => citedTextFromTtl(await fs.readFile(path.join(rootPath, '.minerva', 'excerpts', `${ref}.ttl`), 'utf-8')) ?? '',
      });
    }
  }
  return { items, skipped: candidates - items.length };
}

/** Source ids that have a `body.md` to embed (metadata-only sources are skipped —
 *  their title/abstract still live in the graph for structural search). */
async function listSourcesWithBody(rootPath: string): Promise<string[]> {
  const dir = path.join(rootPath, '.minerva', 'sources');
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await fs.access(path.join(dir, entry.name, 'body.md'));
      out.push(entry.name);
    } catch { /* no body — skip */ }
  }
  return out;
}

/** Every excerpt id (`.minerva/excerpts/<id>.ttl`). */
async function listExcerptIds(rootPath: string): Promise<string[]> {
  const dir = path.join(rootPath, '.minerva', 'excerpts');
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.ttl')).map((e) => e.name.slice(0, -'.ttl'.length));
  } catch {
    return [];
  }
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
