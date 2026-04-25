import path from 'node:path';
import fs from 'node:fs/promises';
import type { SearchProvider, SearchResult } from './types';
import { MiniSearchProvider } from './minisearch-provider';
import type { ProjectContext } from '../project-context-types';

interface SearchState {
  rootPath: string;
  provider: SearchProvider;
}

const states = new Map<string, SearchState>();

function getState(ctx: ProjectContext): SearchState | null {
  return states.get(ctx.rootPath) ?? null;
}

function indexPath(state: SearchState): string {
  return path.join(state.rootPath, '.minerva', 'search-index.json');
}

export async function initSearch(ctx: ProjectContext): Promise<void> {
  let state = states.get(ctx.rootPath);
  if (!state) {
    state = { rootPath: ctx.rootPath, provider: new MiniSearchProvider() };
    states.set(ctx.rootPath, state);
  }
  await state.provider.load(indexPath(state));
}

export async function disposeProject(ctx: ProjectContext): Promise<void> {
  states.delete(ctx.rootPath);
}

export async function indexAllNotes(ctx: ProjectContext): Promise<number> {
  let state = states.get(ctx.rootPath);
  if (!state) {
    state = { rootPath: ctx.rootPath, provider: new MiniSearchProvider() };
    states.set(ctx.rootPath, state);
  }
  state.provider.clear();

  let count = 0;
  await walk(state.rootPath, state.rootPath);
  await state.provider.save(indexPath(state));

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
        state!.provider.index(relativePath, title, content);
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

export function search(ctx: ProjectContext, query: string, opts?: { limit?: number }): SearchResult[] {
  const state = getState(ctx);
  if (!state) return [];
  return state.provider.search(query, opts);
}

export async function persist(ctx: ProjectContext): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  await state.provider.save(indexPath(state));
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
