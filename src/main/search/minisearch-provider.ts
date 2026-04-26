import MiniSearch from 'minisearch';
import fs from 'node:fs/promises';
import type { SearchProvider, SearchResult } from './types';

const SNIPPET_RADIUS = 60; // characters of context around match

export class MiniSearchProvider implements SearchProvider {
  private engine: MiniSearch;
  /** Keep raw content for snippet extraction — MiniSearch doesn't store fields by default */
  private docs = new Map<string, { title: string; content: string }>();

  constructor() {
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
    if (this.docs.has(relativePath)) {
      this.engine.discard(relativePath);
    }
    this.engine.add({ relativePath, title, content });
    this.docs.set(relativePath, { title, content });
  }

  remove(relativePath: string): void {
    if (this.docs.has(relativePath)) {
      this.engine.discard(relativePath);
      this.docs.delete(relativePath);
    }
  }

  search(query: string, opts?: { limit?: number }): SearchResult[] {
    if (!query.trim()) return [];

    const limit = opts?.limit ?? 50;
    const raw = this.engine.search(query);

    return raw.slice(0, limit).map((hit) => {
      const doc = this.docs.get(hit.id as string);
      const snippet = doc ? extractSnippet(doc.content, query) : '';
      return {
        relativePath: hit.id as string,
        title: (hit as { title?: string }).title ?? doc?.title ?? hit.id,
        snippet,
        score: hit.score,
      };
    });
  }

  clear(): void {
    this.engine = MiniSearchProvider.createEngine();
    this.docs.clear();
  }

  async save(destPath: string): Promise<void> {
    const data = {
      index: this.engine.toJSON(),
      docs: Object.fromEntries(this.docs),
    };
    await fs.writeFile(destPath, JSON.stringify(data), 'utf-8');
  }

  async load(srcPath: string): Promise<void> {
    try {
      const raw = await fs.readFile(srcPath, 'utf-8');
      const data = JSON.parse(raw);
      this.engine = MiniSearch.loadJSON(JSON.stringify(data.index), {
        fields: ['title', 'content'],
        storeFields: ['title'],
        idField: 'relativePath',
      });
      this.docs.clear();
      for (const [key, val] of Object.entries(data.docs)) {
        this.docs.set(key, val as { title: string; content: string });
      }
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
