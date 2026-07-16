import MiniSearch from 'minisearch';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SearchProvider, SearchResult } from './types';

const SNIPPET_RADIUS = 60; // characters of context around match

/**
 * Cap on the recently-read-body cache (perf #1111). Bounds snippet reads at
 * O(cap × note size) instead of O(vault) — a handful of note bodies, not the
 * whole corpus. Sized to comfortably cover one result page so paging through
 * or re-running the same query stays off disk.
 */
const SNIPPET_CACHE_MAX = 100;

export class MiniSearchProvider implements SearchProvider {
  private engine: MiniSearch;
  private readonly rootPath: string;
  /**
   * Bounded LRU of recently-read note bodies, used only for snippet extraction
   * (perf #1111). MiniSearch doesn't store field bodies, so snippets are read
   * from disk on demand rather than from a parallel full-corpus map — the note
   * is already on disk. Insertion order is recency (re-inserted on hit); the
   * oldest entry is evicted once `size` exceeds `SNIPPET_CACHE_MAX`, so resident
   * memory stays bounded regardless of vault size.
   */
  private snippetCache = new Map<string, string>();

  constructor(rootPath: string) {
    this.rootPath = rootPath;
    this.engine = MiniSearchProvider.createEngine();
  }

  private static createEngine(): MiniSearch {
    return new MiniSearch({
      fields: ['title', 'content'],
      storeFields: ['title'],
      idField: 'relativePath',
      searchOptions: {
        boost: { title: 3 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
  }

  index(relativePath: string, title: string, content: string): void {
    // MiniSearch requires remove-then-add to update
    if (this.engine.has(relativePath)) {
      this.engine.discard(relativePath);
    }
    this.engine.add({ relativePath, title, content });
    // Body changed on disk — drop any stale cached copy.
    this.snippetCache.delete(relativePath);
  }

  remove(relativePath: string): void {
    if (this.engine.has(relativePath)) {
      this.engine.discard(relativePath);
    }
    this.snippetCache.delete(relativePath);
  }

  async search(query: string, opts?: { limit?: number }): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const limit = opts?.limit ?? 50;
    const raw = this.engine.search(query) as Array<{ id: string; title?: string; score: number }>;

    // Snippets are only needed for the visible page, so read bodies for just
    // the top `limit` hits. Reads run concurrently; the LRU keeps repeated
    // (e.g. per-keystroke) searches over the same notes off disk.
    return Promise.all(
      raw.slice(0, limit).map(async (hit) => {
        const body = await this.readBody(hit.id);
        return {
          relativePath: hit.id,
          title: hit.title ?? hit.id,
          snippet: body ? extractSnippet(body, query) : '',
          score: hit.score,
        };
      }),
    );
  }

  /**
   * Read a note body for snippet extraction, via the bounded LRU. A miss reads
   * from disk and caches; a file that's since moved or been deleted resolves to
   * null so the result still surfaces (title + score) without a snippet.
   */
  private async readBody(relativePath: string): Promise<string | null> {
    const cached = this.snippetCache.get(relativePath);
    if (cached !== undefined) {
      // Refresh recency: re-insert so it becomes the most-recently-used.
      this.snippetCache.delete(relativePath);
      this.snippetCache.set(relativePath, cached);
      return cached;
    }
    try {
      const body = await fs.readFile(path.join(this.rootPath, relativePath), 'utf-8');
      this.snippetCache.set(relativePath, body);
      if (this.snippetCache.size > SNIPPET_CACHE_MAX) {
        const oldest = this.snippetCache.keys().next().value;
        if (oldest !== undefined) this.snippetCache.delete(oldest);
      }
      return body;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.engine = MiniSearchProvider.createEngine();
    this.snippetCache.clear();
  }

  async save(destPath: string): Promise<void> {
    // Persist the index only — note bodies live on disk and are read on demand
    // for snippets (perf #1111), so the JSON no longer duplicates the corpus.
    const data = { index: this.engine.toJSON() };
    await fs.writeFile(destPath, JSON.stringify(data), 'utf-8');
  }

  async load(srcPath: string): Promise<void> {
    try {
      const raw = await fs.readFile(srcPath, 'utf-8');
      const data = JSON.parse(raw) as { index: unknown };
      this.engine = MiniSearch.loadJSON(JSON.stringify(data.index), {
        fields: ['title', 'content'],
        storeFields: ['title'],
        idField: 'relativePath',
      });
      this.snippetCache.clear();
    } catch {
      // No persisted index or corrupt — start fresh
      this.clear();
    }
  }
}

/** Extract a snippet around the first occurrence of any query term */
function extractSnippet(content: string, query: string): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = content.toLowerCase();

  let bestIdx = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1) { bestIdx = idx; break; }
  }

  if (bestIdx === -1) {
    // No exact substring match — return start of content
    return content.slice(0, SNIPPET_RADIUS * 2).replace(/\n/g, ' ').trim();
  }

  const start = Math.max(0, bestIdx - SNIPPET_RADIUS);
  const end = Math.min(content.length, bestIdx + SNIPPET_RADIUS);
  let snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  return snippet;
}
