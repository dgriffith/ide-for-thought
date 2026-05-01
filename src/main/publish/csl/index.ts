/**
 * Citation engine entry point (#247). `buildCitationRenderer` is the
 * one function the pipeline calls — loads every source / excerpt meta
 * under the project, builds a CSL item map, and returns a ready-to-use
 * renderer keyed to the plan's style / locale.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { CitationRenderer } from './renderer';
import { sourceTtlToCsl, excerptTtlToInfo, type CslItem } from './source-to-csl';
import { DEFAULT_STYLE, DEFAULT_LOCALE } from './assets';
import { getMergedStyles, getMergedLocales } from './user-assets';

export { CitationRenderer } from './renderer';
export type { CslItem, ExcerptInfo } from './source-to-csl';

export interface BuildRendererOptions {
  styleId?: string;
  localeId?: string;
}

/**
 * Plan-level citation assets, loaded once by `resolvePlan` and shared
 * across every exporter call. The renderer itself is stateful and
 * per-session (bibliography ordering tracks citedIds) — exporters that
 * want a fresh session call `assets.createRenderer()` per note.
 */
export interface CitationAssets {
  /** Resolved CSL style id after fallback (e.g. 'apa'). Surfaced for the preview UI (#301). */
  styleId: string;
  /** Resolved CSL locale id after fallback (e.g. 'en-US'). */
  localeId: string;
  /** Raw CSL XML for the resolved style — what citeproc-js consumes. */
  style: string;
  /** Raw locale XML. */
  locale: string;
  items: Map<string, CslItem>;
  excerpts: Map<string, { sourceId: string; locator?: string }>;
  knownSourceIds: string[];
  /**
   * Factory for a fresh renderer — one per note for per-note
   * bibliographies. The optional `outputFormat` switches citeproc-js
   * to plain-text output for markdown / clean-text exporters (#250);
   * defaults to HTML for note-html / tree-html.
   */
  createRenderer(opts?: { outputFormat?: 'html' | 'text' }): CitationRenderer;
}

/**
 * Walk `.minerva/sources/*\/meta.ttl` + `.minerva/excerpts/*.ttl`,
 * parse each into CSL-JSON, and return a bundle of assets + factory
 * the exporters use. Unknown styles fall back to APA; unknown locales
 * fall back to en-US.
 */
export async function loadCitationAssets(
  rootPath: string,
  opts: BuildRendererOptions = {},
): Promise<CitationAssets> {
  // Merged registry: bundled + user-imported under .minerva/csl-{styles,locales}/.
  // User entries win on id collision so a project-specific override of a
  // bundled style takes effect without code changes (#302).
  const { styles: availableStyles } = await getMergedStyles(rootPath);
  const { locales: availableLocales } = await getMergedLocales(rootPath);
  const styleId = opts.styleId && availableStyles[opts.styleId] ? opts.styleId : DEFAULT_STYLE;
  const localeId = opts.localeId && availableLocales[opts.localeId] ? opts.localeId : DEFAULT_LOCALE;
  const style = availableStyles[styleId];
  const locale = availableLocales[localeId];

  const items = new Map<string, CslItem>();
  const excerpts = new Map<string, { sourceId: string; locator?: string }>();

  const sourcesDir = path.join(rootPath, '.minerva', 'sources');
  const excerptsDir = path.join(rootPath, '.minerva', 'excerpts');

  // Sources: each id directory contains meta.ttl.
  try {
    const entries = await fs.readdir(sourcesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(sourcesDir, entry.name, 'meta.ttl');
      let ttl: string;
      try { ttl = await fs.readFile(metaPath, 'utf-8'); } catch { continue; }
      items.set(entry.name, sourceTtlToCsl(ttl, entry.name));
    }
  } catch { /* no .minerva/sources — fine, just no citations */ }

  // Excerpts: one .ttl per excerpt id.
  try {
    const entries = await fs.readdir(excerptsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ttl')) continue;
      const excerptId = entry.name.replace(/\.ttl$/, '');
      const ttl = await fs.readFile(path.join(excerptsDir, entry.name), 'utf-8');
      const info = excerptTtlToInfo(ttl, excerptId);
      if (info) excerpts.set(excerptId, { sourceId: info.sourceId, locator: info.locator });
    }
  } catch { /* no .minerva/excerpts */ }

  return {
    styleId,
    localeId,
    style,
    locale,
    items,
    excerpts,
    knownSourceIds: [...items.keys()],
    createRenderer: (opts) => new CitationRenderer(style, locale, items, opts),
  };
}
