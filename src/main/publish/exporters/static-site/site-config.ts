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
import type { SidebarNode } from './sidebar';

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
  /** Runtime-only (not persisted): true when the project ships a
   *  `.minerva/site.css` that the exporter copied + linked (#1135). Set by the
   *  exporter after detecting the file, not by `loadSiteConfig`. */
  hasCustomCss?: boolean;
  /** Runtime-only (not persisted): the left structure-sidebar tree, built from
   *  the EXPORTED note set so exclusions are respected (#1133). Set by the
   *  exporter, threaded into every page's shell. */
  sidebarTree?: SidebarNode[];
}

const DEFAULTS: Omit<SiteConfig, 'title'> = {
  baseUrl: '',
  landing: '',
  excludeTags: ['draft'],
  excludeFolders: [],
  showBacklinks: true,
};

/** Fallback site title when the config sets none (#1134): the project folder
 *  name — the thoughtbase already has a name, so use it instead of "My Notes". */
function defaultTitle(rootPath: string): string {
  return path.basename(rootPath) || 'My Notes';
}

export async function loadSiteConfig(rootPath: string): Promise<SiteConfig> {
  const configPath = path.join(rootPath, '.minerva', 'site-config.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SiteConfig>;
    return mergeWithDefaults(parsed, rootPath);
  } catch {
    // Missing / malformed config → defaults. Not an error path: most
    // projects will start without one and the exporter still works.
    return { ...DEFAULTS, title: defaultTitle(rootPath) };
  }
}

function mergeWithDefaults(partial: Partial<SiteConfig>, rootPath: string): SiteConfig {
  return {
    title: typeof partial.title === 'string' && partial.title ? partial.title : defaultTitle(rootPath),
    baseUrl: typeof partial.baseUrl === 'string' ? partial.baseUrl : DEFAULTS.baseUrl,
    landing: typeof partial.landing === 'string' ? partial.landing : DEFAULTS.landing,
    excludeTags: Array.isArray(partial.excludeTags) ? partial.excludeTags.filter((t) => typeof t === 'string') : [...DEFAULTS.excludeTags],
    excludeFolders: Array.isArray(partial.excludeFolders) ? partial.excludeFolders.filter((t) => typeof t === 'string') : [],
    showBacklinks: typeof partial.showBacklinks === 'boolean' ? partial.showBacklinks : DEFAULTS.showBacklinks,
  };
}
