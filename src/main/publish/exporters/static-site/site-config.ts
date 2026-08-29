/**
 * Site-config loader for the static-site exporter (#252).
 *
 * Reads `.minerva/site-config.json` and merges it with safe defaults
 * so an empty / absent config still produces a usable site. Lives
 * under .minerva/ so it travels with the project via git — different
 * thoughtbases can ship different sites.
 */

import path from 'node:path';
import type { SidebarNode } from './sidebar';
import { loadConfigFile, asRecord, asString, asBool, asStringArray } from '../../../config/config-store';

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
  const defaults: SiteConfig = { ...DEFAULTS, title: defaultTitle(rootPath) };
  return loadConfigFile<SiteConfig>(
    () => path.join(rootPath, '.minerva', 'site-config.json'),
    (raw) => {
      const o = asRecord(raw);
      return {
        title: asString(o.title, '') || defaults.title,
        baseUrl: asString(o.baseUrl, DEFAULTS.baseUrl),
        landing: asString(o.landing, DEFAULTS.landing),
        excludeTags: asStringArray(o.excludeTags, [...DEFAULTS.excludeTags]),
        excludeFolders: asStringArray(o.excludeFolders, []),
        showBacklinks: asBool(o.showBacklinks, DEFAULTS.showBacklinks),
      };
    },
    defaults,
  );
}
