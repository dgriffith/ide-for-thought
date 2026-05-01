/**
 * Static-site exporter (#252).
 *
 * Renders the whole non-private project as a browseable static site:
 * a page per note, backlinks on every page, tag index, consolidated
 * bibliography, and a small client-side search index. Output is a
 * plain directory tree the user hosts on GitHub Pages, Netlify, S3,
 * or whatever else.
 *
 * v1 scope is the most-visible 80% of the issue's acceptance list:
 *   - per-note pages with backlinks + sidebar + nav header
 *   - tag cloud + per-tag list pages
 *   - consolidated bibliography page
 *   - shared style.css + search.js + search.json
 *   - broken-wiki-link strikethrough
 *
 * Deferred to follow-ups:
 *   - graph view (needs a bundled layout library)
 *   - pretty URLs (no `.html`)
 *   - theme-token customisation beyond the bundled "garden" theme
 *   - incremental rebuild
 */

import path from 'node:path';
import type { Exporter, ExportOutput, ExportPlanFile } from '../../types';
import { loadSiteConfig, type SiteConfig } from './site-config';
import { buildSiteIndex, noteUrl } from './site-data';
import {
  renderNotePage,
  renderTagCloud,
  renderTagPage,
  renderAllNotesIndex,
  renderReferencesPage,
} from './render';
import { STATIC_SITE_STYLE } from './style';
import { SITE_SEARCH_SCRIPT } from './search-script';

export const staticSiteExporter: Exporter = {
  id: 'static-site',
  label: 'Project as Static Site',
  // Project-only — the whole point is "publish this thoughtbase".
  // Single-note / folder static sites would be a separate, weirder
  // product (a one-page site? a folder-of-notes site?).
  accepts: (input) => input.kind === 'project',
  acceptedKinds: ['project'],
  async run(plan) {
    const rootPath = plan.rootPath ?? '';
    const config = await loadSiteConfig(rootPath);
    const allNotes = plan.inputs.filter((f) => f.kind === 'note');
    const notes = applyConfigFilters(allNotes, config);
    if (notes.length === 0) {
      return { files: [], summary: 'Nothing to export — every note was filtered out by site-config.' };
    }

    const index = buildSiteIndex(notes);
    const files: ExportOutput['files'] = [];

    // Track citations bundle-wide so the consolidated References /
    // Bibliography page de-dupes across the whole site (same shape as
    // the tree-html bundle bibliography from #300).
    const allCitedIds = new Set<string>();
    let isNoteStyle = false;

    for (const note of notes) {
      const renderer = plan.citations?.createRenderer() ?? null;
      const rootRel = relativeToRoot(note.relativePath);
      const html = renderNotePage({ note, plan, config, index, rootRelative: rootRel, renderer });
      files.push({ path: noteUrl(note.relativePath), contents: html });
      if (renderer) {
        for (const id of renderer.cited()) allCitedIds.add(id);
        if (renderer.isNoteStyle) isNoteStyle = true;
      }
    }

    // Tag cloud + per-tag pages.
    if (index.tags.size > 0) {
      files.push({
        path: 'tags/index.html',
        contents: renderTagCloud(config, index, '../'),
      });
      for (const [tag, taggedNotes] of index.tags) {
        files.push({
          path: `tags/${encodeFilename(tag)}.html`,
          contents: renderTagPage(tag, taggedNotes, config, '../'),
        });
      }
    }

    // Landing page: site-config.landing wins; else "All Notes" list.
    const landingNote = config.landing
      ? notes.find((n) => n.relativePath === config.landing)
      : null;
    if (landingNote) {
      const renderer = plan.citations?.createRenderer() ?? null;
      const html = renderNotePage({
        note: landingNote,
        plan,
        config,
        index,
        rootRelative: '',
        renderer,
      });
      files.push({ path: 'index.html', contents: html });
      if (renderer) {
        for (const id of renderer.cited()) allCitedIds.add(id);
        if (renderer.isNoteStyle) isNoteStyle = true;
      }
    } else {
      files.push({ path: 'index.html', contents: renderAllNotesIndex(notes, config) });
    }

    // Consolidated bibliography.
    if (allCitedIds.size > 0 && plan.citations) {
      const consolidator = plan.citations.createRenderer();
      const bib = consolidator.renderBibliographyFor([...allCitedIds]);
      if (bib.entries.length > 0) {
        files.push({
          path: 'references.html',
          contents: renderReferencesPage(bib.entries, isNoteStyle, config),
        });
      }
    }

    // Search index — a flat array of {url, title, snippet}. Loaded
    // lazily by search.js on the first keystroke; small enough at
    // ~10k notes that the naive linear filter stays fast.
    files.push({
      path: 'search.json',
      contents: JSON.stringify(index.searchRecords),
    });
    files.push({ path: 'search.js', contents: SITE_SEARCH_SCRIPT });
    files.push({ path: 'style.css', contents: STATIC_SITE_STYLE });

    const dropped = allNotes.length - notes.length + plan.excluded.length;
    const summary = dropped > 0
      ? `Site of ${notes.length} note${notes.length === 1 ? '' : 's'} (${dropped} filtered).`
      : `Site of ${notes.length} note${notes.length === 1 ? '' : 's'}.`;
    return { files, summary };
  },
};

/**
 * Apply site-config filters: drop notes wearing any excluded tag, or
 * sitting in any excluded folder. Private-by-default exclusions
 * already happened upstream in the pipeline (#246).
 */
function applyConfigFilters(notes: ExportPlanFile[], config: SiteConfig): ExportPlanFile[] {
  const excludeTags = new Set(config.excludeTags);
  const excludeFolders = config.excludeFolders.map((f) => f.replace(/\/$/, ''));
  return notes.filter((note) => {
    for (const folder of excludeFolders) {
      if (note.relativePath === folder || note.relativePath.startsWith(`${folder}/`)) {
        return false;
      }
    }
    if (excludeTags.size === 0) return true;
    const fmTags = note.frontmatter.tags;
    let tags: string[] = [];
    if (Array.isArray(fmTags)) {
      tags = fmTags
        .filter((t): t is string | number => typeof t === 'string' || typeof t === 'number')
        .map((t) => String(t));
    } else if (typeof fmTags === 'string') {
      tags = fmTags.split(',').map((t) => t.trim());
    }
    return !tags.some((t) => excludeTags.has(t));
  });
}

/** Number of `../` segments needed to climb from a note's URL to the site root. */
function relativeToRoot(relativePath: string): string {
  const depth = relativePath.split('/').length - 1;
  return depth === 0 ? '' : '../'.repeat(depth);
}

/**
 * Sanitise a tag for use as a filename. Strips slashes and other
 * characters that'd break the URL or the filesystem; collapses
 * everything else to `-`.
 */
function encodeFilename(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'tag';
}

// Reserved for future image/asset copying — keeps the import shape
// stable so the follow-up that copies referenced images can land
// without a churny import diff.
void path;
