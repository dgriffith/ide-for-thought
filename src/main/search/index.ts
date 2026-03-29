import path from 'node:path';
import fs from 'node:fs/promises';
import type { SearchProvider, SearchResult } from './types';
import { MiniSearchProvider } from './minisearch-provider';

let provider: SearchProvider = new MiniSearchProvider();
let currentRootPath: string | null = null;

function indexPath(): string {
  return path.join(currentRootPath!, '.minerva', 'search-index.json');
}

export async function initSearch(rootPath: string): Promise<void> {
  currentRootPath = rootPath;
  await provider.load(indexPath());
}

export async function indexAllNotes(rootPath: string): Promise<number> {
  currentRootPath = rootPath;
  provider.clear();

  let count = 0;
  await walk(rootPath, rootPath);
  await provider.save(indexPath());

  async function walk(dirPath: string, root: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, root);
      } else if (entry.name.endsWith('.md')) {
        const relativePath = path.relative(root, fullPath);
        const content = await fs.readFile(fullPath, 'utf-8');
        const title = extractTitle(content) ?? path.basename(relativePath, '.md');
        provider.index(relativePath, title, content);
        count++;
      }
    }
  }

  return count;
}

export function indexNote(relativePath: string, content: string): void {
  const title = extractTitle(content) ?? path.basename(relativePath, '.md');
  provider.index(relativePath, title, content);
}

export function removeNote(relativePath: string): void {
  provider.remove(relativePath);
}

export function search(query: string, opts?: { limit?: number }): SearchResult[] {
  return provider.search(query, opts);
}

export async function persist(): Promise<void> {
  if (!currentRootPath) return;
  await provider.save(indexPath());
}

/** Simple title extraction matching what the graph parser does */
function extractTitle(content: string): string | null {
  // Frontmatter title
  const fmMatch = content.match(/^---\n[\s\S]*?\ntitle:\s*["']?(.+?)["']?\s*\n[\s\S]*?\n---/);
  if (fmMatch) return fmMatch[1];
  // First H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  return h1Match ? h1Match[1].trim() : null;
}
