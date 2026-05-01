/**
 * Site-config loader for the static-site exporter (#252).
 *
 * Reads `.minerva/site-config.json` and merges it with safe defaults
 * so an empty / absent config still produces a usable site. Lives
 * under .minerva/ so it travels with the project via git — different
 * thoughtbases can ship different sites.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface SiteConfig {
  /** Site title shown in the nav header and `<title>` of every page. */
  title: string;
  /** Base URL for absolute links; used in canonical tags. Empty = relative. */
  baseUrl: string;
  /** Relative path to the note used as `index.html`. Empty = generated "All Notes" list. */
  landing: string;
  /** Tags whose notes are excluded from the site (in addition to private rules). */
  excludeTags: string[];
  /** Folder paths whose notes are excluded from the site. */
  excludeFolders: string[];
  /** Show per-note backlinks. */
  showBacklinks: boolean;
}

const DEFAULTS: SiteConfig = {
  title: 'My Notes',
  baseUrl: '',
  landing: '',
  excludeTags: ['draft'],
  excludeFolders: [],
  showBacklinks: true,
};

export async function loadSiteConfig(rootPath: string): Promise<SiteConfig> {
  const configPath = path.join(rootPath, '.minerva', 'site-config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SiteConfig>;
    return mergeWithDefaults(parsed);
  } catch {
    // Missing / malformed config → defaults. Not an error path: most
    // projects will start without one and the exporter still works.
    return { ...DEFAULTS };
  }
}

function mergeWithDefaults(partial: Partial<SiteConfig>): SiteConfig {
  return {
    title: typeof partial.title === 'string' && partial.title ? partial.title : DEFAULTS.title,
    baseUrl: typeof partial.baseUrl === 'string' ? partial.baseUrl : DEFAULTS.baseUrl,
    landing: typeof partial.landing === 'string' ? partial.landing : DEFAULTS.landing,
    excludeTags: Array.isArray(partial.excludeTags) ? partial.excludeTags.filter((t) => typeof t === 'string') : [...DEFAULTS.excludeTags],
    excludeFolders: Array.isArray(partial.excludeFolders) ? partial.excludeFolders.filter((t) => typeof t === 'string') : [],
    showBacklinks: typeof partial.showBacklinks === 'boolean' ? partial.showBacklinks : DEFAULTS.showBacklinks,
  };
}
