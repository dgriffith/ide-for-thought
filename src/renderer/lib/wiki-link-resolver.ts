/**
 * Resolve a wiki-link target string to an actual project-relative
 * `.md` path. Used by App.handleNavigate so users can write short
 * forms — `[[raft]]`, `[[Sets, Functions]]` — and have them open the
 * right file regardless of how deeply nested it is.
 *
 * Without this, navigation does a naive `${target}.md` lookup and
 * fails for any link that isn't a full project-relative path. The
 * propose_notes bundle-link-fixup writes full paths to keep that
 * deterministic; this resolver picks up everything else.
 *
 * Resolution priority:
 *   1. Exact relativePath match (with or without .md)
 *   2. Basename match — case-sensitive
 *   3. Frontmatter alias (case-insensitive), if a map is provided (#469)
 *   4. Slugified basename match (case-insensitive, punctuation-fuzzy)
 *   5. Slugified full stem match (handles "journey/raft" pointing at
 *      "notes/topic/journey/raft.md")
 *   6. Path-suffix slug match for unambiguous tails of nested paths
 */

import type { NoteFile } from '../../shared/types';

export function flattenNoteFiles(tree: NoteFile[]): NoteFile[] {
  const out: NoteFile[] = [];
  const walk = (nodes: NoteFile[]) => {
    for (const n of nodes) {
      if (n.isDirectory) {
        if (n.children) walk(n.children);
      } else {
        out.push(n);
      }
    }
  };
  walk(tree);
  return out;
}

const stripMd = (s: string) => s.replace(/\.md$/i, '');
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Returns the project-relative path of the matched note (with .md), or
 * null when nothing matches. Targets ending in `.md` are tried as-is
 * first, otherwise treated as a stem.
 *
 * `aliases` is a frontmatter alias → relativePath map (#469). Title /
 * filename matches always win over aliases — the indexer's
 * rebuildAliasMap already drops alias keys that collide with canonical
 * names, so the alias check sits between basename and slug-fuzzy
 * resolution.
 */
export function resolveWikiLinkTarget(
  target: string,
  files: Pick<NoteFile, 'relativePath' | 'isDirectory'>[],
  aliases?: Record<string, string>,
): string | null {
  const targetStem = stripMd(target);
  const targetSlug = slug(targetStem);

  const noteFiles = files.filter((f) => !f.isDirectory && f.relativePath.endsWith('.md'));

  // 1. Exact relativePath
  for (const f of noteFiles) {
    if (stripMd(f.relativePath) === targetStem) return f.relativePath;
  }

  // 2. Basename exact (case-sensitive)
  for (const f of noteFiles) {
    const base = stripMd(f.relativePath.split('/').pop() ?? '');
    if (base === targetStem) return f.relativePath;
  }

  // 3. Frontmatter alias (case-insensitive), if a map was supplied.
  if (aliases) {
    const hit = aliases[targetStem.toLowerCase()];
    if (hit) return hit;
  }

  // 4. Basename slug match
  for (const f of noteFiles) {
    const base = stripMd(f.relativePath.split('/').pop() ?? '');
    if (slug(base) === targetSlug) return f.relativePath;
  }

  // 6. Full-stem slug match (target like "notes/topic/raft" against the
  //    file's full stem slug)
  for (const f of noteFiles) {
    if (slug(stripMd(f.relativePath)) === targetSlug) return f.relativePath;
  }

  // 7. Path-suffix slug match — target slug ends a file's full-stem
  //    slug at a "-" boundary (so "journey-raft" matches "notes-topic-
  //    journey-raft" but "raft" does NOT match "notes-craft" coincidentally,
  //    that's caught by step 4). Useful for "[[journey/raft]]"-style links
  //    where the user gave an unambiguous tail of the path.
  if (targetSlug.length > 0) {
    for (const f of noteFiles) {
      const fullSlug = slug(stripMd(f.relativePath));
      if (fullSlug === targetSlug) continue; // already covered by step 6
      if (
        fullSlug.endsWith(`-${targetSlug}`) ||
        fullSlug.endsWith(`/${targetSlug}`)
      ) {
        return f.relativePath;
      }
    }
  }

  return null;
}
