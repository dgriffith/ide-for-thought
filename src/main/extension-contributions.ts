/**
 * What is installed in each open extension point (#2618) — gathered here, in
 * the composition root, because reading it takes skills, saved queries,
 * templates, CSL and the MCP config, which the graph package must not import.
 * The graph materialises what this reports (`graph.setExtensionContributions`).
 *
 * Refreshed when a project opens and whenever a window regains focus — the
 * same moment the menu's caches are dropped (#2221), and for the same reason:
 * an edit made outside the app means having been in another application. A
 * contribution saved inside the app (a new saved query, an imported skill)
 * shows on the next focus or reopen; the catalog is a description, not a
 * live index.
 *
 * One unreadable source costs only its own entries: a corrupt MCP config must
 * not blank the skills.
 */
import path from 'node:path';
import os from 'node:os';
import type { ProjectContext } from './project-context-types';
import type { Contribution } from '../shared/extensions/contributions';
import { setExtensionContributions } from './graph/index';
import { getSkillCatalog } from './skills/loader';
import { loadTypeCatalog } from './types/loader';
import { listSavedQueries } from './saved-queries';
import { STOCK_QUERIES } from '../shared/stock-queries';
import { listTemplates } from './notebase/templates';
import { getMergedStyles } from './publish/csl/user-assets';
import { getStoredServers } from './mcp-servers/config-store';
import { logger } from '../shared/logger';

type Reader = (rootPath: string) => Promise<Contribution[]>;

const READERS: Record<string, Reader> = {
  skills: async () => (await getSkillCatalog()).skills.map((s) => ({
    point: 'skills', id: s.id, label: s.name, source: s.source === 'stock' ? 'stock' : 'user',
  })),
  objectTypes: async (rootPath) => (await loadTypeCatalog(rootPath)).types.map((t) => ({
    point: 'object-types', id: t.id, label: t.label,
    // A user type is the thoughtbase's own `.minerva/types/` file.
    source: t.source === 'stock' ? 'stock' : 'thoughtbase',
  })),
  savedQueries: (rootPath) => Promise.resolve([
    ...STOCK_QUERIES.map((q): Contribution => ({ point: 'saved-queries', id: `stock:${q.name}`, label: q.name, source: 'stock' })),
    ...listSavedQueries(rootPath).map((q): Contribution => ({
      point: 'saved-queries', id: q.id, label: q.name,
      source: q.scope === 'global' ? 'user' : 'thoughtbase',
      location: displayPath(rootPath, q.filePath),
    })),
  ]),
  templates: async (rootPath) => (await listTemplates(rootPath)).map((t) => ({
    point: 'note-templates', id: t.filename, label: t.name, source: 'thoughtbase',
    location: `.minerva/templates/${t.filename}`,
  })),
  csl: async (rootPath) => {
    const { labels, userIds } = await getMergedStyles(rootPath);
    return Object.entries(labels).map(([id, label]) => ({
      point: 'csl-styles', id, label, source: userIds.has(id) ? 'thoughtbase' : 'stock',
    }));
  },
  // Name and id only — never the command, args, env or URL.
  mcpServers: async () => (await getStoredServers()).map((s) => ({
    point: 'mcp-servers', id: s.id, label: s.name, source: 'user',
  })),
};

/** A path as the user would recognise it: thoughtbase-relative, or ~-prefixed. */
function displayPath(rootPath: string, abs: string): string {
  if (abs.startsWith(rootPath + path.sep)) return path.relative(rootPath, abs);
  const home = os.homedir();
  return abs.startsWith(home + path.sep) ? `~/${path.relative(home, abs)}` : abs;
}

export async function gatherContributions(rootPath: string): Promise<Contribution[]> {
  const parts = await Promise.all(Object.entries(READERS).map(async ([name, read]) => {
    try {
      return await read(rootPath);
    } catch (err) {
      logger('project-context').warn(`extension catalog: couldn't read ${name}; its contributions are omitted:`, err);
      return [];
    }
  }));
  return parts.flat();
}

/** Gather this project's contributions and hand them to its graph. */
export async function refreshExtensionContributions(ctx: ProjectContext): Promise<void> {
  setExtensionContributions(ctx, await gatherContributions(ctx.rootPath));
}
