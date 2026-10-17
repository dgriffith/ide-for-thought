/**
 * Saved-query files, without Electron (#2654): the types, the parser, and the
 * installed plugins' queries. Split out of `saved-queries.ts`, which needs
 * Electron for the global queries folder (`userData`), so `minerva plugin
 * check` can read a plugin's queries from the CLI. `saved-queries.ts`
 * re-exports all of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PluginOrigin } from '../shared/plugins/format';
import { contributionsTo, loadedPluginScan } from './plugins/registry';
import { logger } from '../shared/logger';

export type QueryLanguage = 'sparql' | 'sql';

export interface SavedQuery {
  id: string;       // filename without extension
  name: string;
  description: string;
  query: string;
  language: QueryLanguage;
  /** `plugin`: from an installed plugin (#2633) — read-only here. */
  scope: 'project' | 'global' | 'plugin';
  /** Set when `scope` is `'plugin'`. */
  plugin?: PluginOrigin;
  filePath: string;  // absolute path for deletion
  /** #315 — null = ungrouped. */
  group: string | null;
  /** #315 — null = no explicit position; falls to alphabetical by name. */
  order: number | null;
}

export function languageFromPath(filePath: string): QueryLanguage {
  return filePath.endsWith('.sql') ? 'sql' : 'sparql';
}

/** Parse query content string into metadata + body (pure, no I/O) */
export function parseQueryContent(
  content: string,
  id: string,
  scope: SavedQuery['scope'],
  language: QueryLanguage,
): Omit<SavedQuery, 'filePath'> {
  let name = id;
  let description = '';
  let group: string | null = null;
  let order: number | null = null;

  const nameMatch = content.match(/^#\s*@name\s+(.+)$/m);
  if (nameMatch) name = nameMatch[1]!.trim();
  const descMatch = content.match(/^#\s*@description\s+(.+)$/m);
  if (descMatch) description = descMatch[1]!.trim();
  const groupMatch = content.match(/^#\s*@group\s+(.+)$/m);
  if (groupMatch) {
    const g = groupMatch[1]!.trim();
    if (g) group = g;
  }
  const orderMatch = content.match(/^#\s*@order\s+(-?\d+)$/m);
  if (orderMatch) order = parseInt(orderMatch[1]!, 10);

  const query = content
    .split('\n')
    .filter((line) => !line.match(/^#\s*@(name|description|group|order)\s/))
    .join('\n')
    .trim();

  return { id, name, description, query, language, scope, group, order };
}

export function parseQueryFile(filePath: string, scope: SavedQuery['scope']): SavedQuery {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const id = path.basename(filePath, ext);
  return { ...parseQueryContent(content, id, scope, languageFromPath(filePath)), filePath };
}

/**
 * Installed plugins' queries (#2633), from the last finished plugin scan —
 * read synchronously, like the rest of this listing. One that can't be read
 * costs only itself.
 */
export function listPluginQueries(): SavedQuery[] {
  const out: SavedQuery[] = [];
  for (const { plugin, contribution } of contributionsTo(loadedPluginScan(), 'saved-queries')) {
    const origin = { id: plugin.manifest.id, name: plugin.manifest.name, version: plugin.manifest.version };
    try {
      out.push({ ...parseQueryFile(contribution.absolutePath, 'plugin'), plugin: origin });
    } catch (e) {
      logger('plugins').warn(`${origin.id}: query ${contribution.path} couldn't be read:`, e);
    }
  }
  return out;
}
