/**
 * Site-wide indices computed once and reused across every page render
 * in the static-site exporter (#252):
 *
 *   - backlink map: who links to me?
 *   - tag map: which notes wear this tag?
 *   - search records: a flat list of {url, title, snippet} for the
 *     client-side search index.
 *
 * Lives separate from the page renderer so the indices are easy to
 * test in isolation without spinning up markdown-it.
 */

import { extractWikiLinkTargets } from '../../tree-resolver';
import type { ExportPlanFile } from '../../types';

export interface SiteIndex {
  /** Backlinks per note: relativePath → [{ relativePath, title }, …]. */
  backlinks: Map<string, Array<{ relativePath: string; title: string }>>;
  /** tag → [{ relativePath, title }, …], sorted by title. */
  tags: Map<string, Array<{ relativePath: string; title: string }>>;
  /** Flat per-note records used to seed the search index. */
  searchRecords: Array<{ url: string; title: string; snippet: string }>;
}

export function buildSiteIndex(notes: ExportPlanFile[]): SiteIndex {
  const titleByPath = new Map<string, string>();
  for (const n of notes) titleByPath.set(n.relativePath, n.title);

  const backlinks = new Map<string, Array<{ relativePath: string; title: string }>>();
  const tags = new Map<string, Array<{ relativePath: string; title: string }>>();
  const searchRecords: SiteIndex['searchRecords'] = [];

  for (const note of notes) {
    // Backlinks: every wiki-link the note emits points back at the
    // target. The link resolver matches with-or-without the `.md`
    // extension, so try both shapes when looking up the target.
    for (const target of extractWikiLinkTargets(note.content)) {
      const targetPath = resolveLinkTarget(target, titleByPath);
      if (!targetPath || targetPath === note.relativePath) continue;
      const list = backlinks.get(targetPath) ?? [];
      // Skip duplicates: a note that links to the same target twice
      // shouldn't show twice in the backlinks list.
      if (!list.some((b) => b.relativePath === note.relativePath)) {
        list.push({ relativePath: note.relativePath, title: note.title });
        backlinks.set(targetPath, list);
      }
    }

    // Tags from frontmatter `tags:` (array or comma-separated string).
    for (const tag of extractTags(note)) {
      const list = tags.get(tag) ?? [];
      list.push({ relativePath: note.relativePath, title: note.title });
      tags.set(tag, list);
    }

    searchRecords.push({
      url: noteUrl(note.relativePath),
      title: note.title,
      snippet: extractSnippet(note.content),
    });
  }

  // Sort backlink + tag lists for deterministic output order.
  for (const list of backlinks.values()) list.sort((a, b) => a.title.localeCompare(b.title));
  for (const list of tags.values()) list.sort((a, b) => a.title.localeCompare(b.title));

  return { backlinks, tags, searchRecords };
}

/**
 * `.md` → `.html` URL transform used everywhere the site links to a note.
 * Single source of truth so a follow-up ticket switching to pretty URLs
 * (no .html) only has one place to flip.
 */
export function noteUrl(relativePath: string): string {
  return relativePath.replace(/\.md$/i, '.html');
}

function resolveLinkTarget(
  target: string,
  titleByPath: Map<string, string>,
): string | null {
  // Try exact match first, then with `.md` suffix.
  if (titleByPath.has(target)) return target;
  const withMd = target.endsWith('.md') ? target : `${target}.md`;
  if (titleByPath.has(withMd)) return withMd;
  return null;
}

function extractTags(note: ExportPlanFile): string[] {
  const fmTags = note.frontmatter.tags;
  if (Array.isArray(fmTags)) {
    return fmTags
      .filter((t): t is string | number => typeof t === 'string' || typeof t === 'number')
      .map((t) => String(t).trim())
      .filter(Boolean);
  }
  if (typeof fmTags === 'string') {
    return fmTags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

/**
 * First ~280 characters of plain-text body for the search index. Strips
 * front-matter, headings, code fences, and most markdown syntax so the
 * search snippet reads like prose.
 */
function extractSnippet(content: string): string {
  let body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  body = body.replace(/```[\s\S]*?```/g, ' ');
  body = body.replace(/^#+\s+/gm, '');
  body = body.replace(/\[\[[^\]]*\]\]/g, ' ');
  body = body.replace(/[*_`>-]/g, ' ');
  body = body.replace(/\s+/g, ' ').trim();
  return body.length > 280 ? body.slice(0, 280) + '…' : body;
}
