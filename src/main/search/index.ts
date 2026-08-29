import path from 'node:path';
import fs from 'node:fs/promises';
import type { SearchProvider, SearchResult } from './types';
import { MiniSearchProvider } from './minisearch-provider';
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';
import { isIgnoredEntry } from '../notebase/ignored-dirs';
import { logger } from '../../shared/logger';

interface SearchState {
  rootPath: string;
  provider: SearchProvider;
  /** Pending debounced-persist timer (perf #1107), or null if none scheduled. */
  persistTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * How long to wait after the last `schedulePersist` call before actually
 * writing the index to disk (perf #1107). `persist` serializes the entire
 * MiniSearch index — O(total corpus bytes), not O(the one changed note) — so
 * calling it synchronously on every save (the old behavior) meant a
 * multi-megabyte JSON.stringify + write on every ~1s autosave tick in a large
 * vault. This coalesces a burst of saves into one write after things go
 * quiet. A crash before the timer fires loses only index freshness, not
 * data — the index is fully reconstructible via `indexAllNotes`.
 */
let persistDebounceMs = 3000;

/** Test-only: shrink the debounce window instead of waiting out the real one. */
export function _setPersistDebounceMsForTests(ms: number): void {
  persistDebounceMs = ms;
}

// Dispose clears any pending debounce timer so it can't fire after the
// project's state (and possibly the whole process, on the last window) is
// gone. persist() itself already cancels the timer on every explicit call
// (release/quit paths persist synchronously before disposing), so this is a
// defensive backstop, not the primary flush path.
const store = createProjectStore<SearchState>({
  dispose: (state) => {
    if (state.persistTimer) clearTimeout(state.persistTimer);
  },
});

function getState(ctx: ProjectContext): SearchState | null {
  return store.get(ctx);
}

/** Return the project's search state, creating an empty one if absent. */
function getOrCreateState(ctx: ProjectContext): SearchState {
  let state = store.get(ctx);
  if (!state) {
    state = { rootPath: ctx.rootPath, provider: new MiniSearchProvider(ctx.rootPath), persistTimer: null };
    store.set(ctx, state);
  }
  return state;
}

function indexPath(state: SearchState): string {
  return path.join(state.rootPath, '.minerva', 'search-index.json');
}

export async function initSearch(ctx: ProjectContext): Promise<void> {
  const state = getOrCreateState(ctx);
  await state.provider.load(indexPath(state));
}

export function disposeProject(ctx: ProjectContext): void {
  void store.dispose(ctx);
}

export async function indexAllNotes(ctx: ProjectContext): Promise<number> {
  const state = getOrCreateState(ctx);
  state.provider.clear();

  let count = 0;
  await walk(state.rootPath, state.rootPath);
  await state.provider.save(indexPath(state));

  async function walk(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, root);
      } else if (entry.name.endsWith('.md')) {
        const relativePath = path.relative(root, fullPath);
        const content = await fs.readFile(fullPath, 'utf-8');
        const title = extractTitle(content) ?? path.basename(relativePath, '.md');
        state.provider.index(relativePath, title, content);
        count++;
      }
    }
  }

  return count;
}

export function indexNote(ctx: ProjectContext, relativePath: string, content: string): void {
  const state = getState(ctx);
  if (!state) return;
  const title = extractTitle(content) ?? path.basename(relativePath, '.md');
  state.provider.index(relativePath, title, content);
}

export function removeNote(ctx: ProjectContext, relativePath: string): void {
  const state = getState(ctx);
  if (!state) return;
  state.provider.remove(relativePath);
}

export function search(ctx: ProjectContext, query: string, opts?: { limit?: number }): Promise<SearchResult[]> {
  const state = getState(ctx);
  if (!state) return Promise.resolve([]);
  return state.provider.search(query, opts);
}

export async function persist(ctx: ProjectContext): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  if (state.persistTimer) {
    clearTimeout(state.persistTimer);
    state.persistTimer = null;
  }
  await state.provider.save(indexPath(state));
}

/**
 * Debounced counterpart to `persist` (perf #1107) — arms (or re-arms) a timer
 * to persist after the debounce window elapses with no further calls, instead
 * of writing immediately. This is what the per-save write path calls;
 * anything that needs an on-disk guarantee right now (project release, app
 * quit, a manual rebuild) should keep calling `persist` directly.
 */
export function schedulePersist(ctx: ProjectContext): void {
  const state = getState(ctx);
  if (!state) return;
  if (state.persistTimer) clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(async () => {
    state.persistTimer = null;
    try {
      await state.provider.save(indexPath(state));
    } catch (err) {
      logger('search').warn(`debounced persist failed for ${state.rootPath}:`, err);
    }
  }, persistDebounceMs);
}

/** Simple title extraction matching what the graph parser does */
function extractTitle(content: string): string | null {
  // Frontmatter title
  const fmMatch = content.match(/^---\n[\s\S]*?\ntitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?\n---/);
  if (fmMatch) return fmMatch[1]!;
  // First H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  return h1Match ? h1Match[1]!.trim() : null;
}
