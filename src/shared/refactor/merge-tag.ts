/**
 * Merge one tag into another — which is also how a tag is renamed (#2430).
 *
 * Pure content rewrites; `main/tags/merge-tags.ts` drives them across the
 * thoughtbase. Every occurrence of `from` moves to `to`, using the nested-tag
 * prefix model of #466: merging `ml` into `machine-learning` also moves
 * `ml/nlp` to `machine-learning/nlp`. `mlops` is a different tag and is left
 * alone.
 *
 * Matching is exact (case-sensitive), because that is how the graph identifies
 * a tag: `#ML` and `#ml` are two rows in the Tags panel, and a merge started
 * from one of them must not quietly swallow the other.
 *
 * Nothing here writes a new tag lexer. Inline tags are located with
 * `shared/inline-tags` (the same lexer the indexer uses), so code spans, code
 * fences, headings and URL fragments are untouched for the same reason the
 * indexer never reads them as tags. Frontmatter goes through the existing
 * frontmatter helpers.
 */
import { findInlineTags, normalizeNestedTag } from '../inline-tags';
import { patchFrontmatterProperties, readFrontmatterProperties } from './frontmatter-patch';

/** What a tag merge would change, before it runs (the confirm dialog's
 *  counts). */
export interface TagMergePreview {
  /** Notes whose content the merge rewrites. */
  notes: number;
  /** Sources whose `meta.ttl` tag lines the merge rewrites. */
  sources: number;
  /** Sources that carry the tag only as a `#hashtag` inside their captured
   *  text (`body.md`). The merge doesn't edit captured text, so these keep
   *  the old tag; reported so the confirm can say so rather than surprise. */
  sourcesBodyOnly: number;
  /** Distinct nested tags (`from/…`) that move along with `from`. */
  nestedTags: string[];
  /** True when `to` isn't in the vocabulary yet — the merge is a rename. */
  isRename: boolean;
}

/** What a tag merge changed. */
export interface TagMergeResult {
  /** Notes rewritten, by relative path. */
  notePaths: string[];
  /** Sources whose meta.ttl changed, by id. */
  sourceIds: string[];
  /** Per-item failures; the merge keeps going past one bad note (a note
   *  deleted mid-run, an unwritable file). */
  errors: Array<{ path: string; error: string }>;
}

/** Strip one leading `#` and surrounding whitespace from a typed tag name. */
export function cleanTagInput(raw: string): string {
  return raw.trim().replace(/^#/, '').trim();
}

/**
 * Validate a merge request. Throws with a message fit for the user when
 * either name isn't a tag the indexer would recognise, or when they're the
 * same tag (a no-op is not a merge).
 */
export function assertTagMerge(from: string, to: string): void {
  if (normalizeNestedTag(from) !== from) throw new Error(`"${from}" is not a tag name.`);
  if (normalizeNestedTag(to) !== to) {
    throw new Error(`"${to}" is not a valid tag name. A tag starts with a letter and uses letters, digits, "-", "_" and "/".`);
  }
  if (from === to) throw new Error(`#${from} is already called that.`);
}

/**
 * The name `tag` has after merging `from` into `to`, or null when the merge
 * doesn't touch it. `from` → `to`; `from/x` → `to/x`; anything else → null.
 */
export function retargetTag(tag: string, from: string, to: string): string | null {
  if (tag === from) return to;
  if (tag.startsWith(`${from}/`)) return to + tag.slice(from.length);
  return null;
}

/**
 * Rewrite inline `#tag` occurrences of `from` (and `from/…`) to `to`.
 * Only what the indexer reads as a tag is touched — see the module header.
 */
export function rewriteInlineTags(content: string, from: string, to: string): { content: string; count: number } {
  let out = '';
  let cursor = 0;
  let count = 0;
  for (const occ of findInlineTags(content)) {
    const next = retargetTag(occ.tag, from, to);
    if (next === null) continue;
    out += content.slice(cursor, occ.start) + next;
    cursor = occ.end;
    count++;
  }
  if (count === 0) return { content, count: 0 };
  return { content: out + content.slice(cursor), count };
}

/**
 * Rewrite the frontmatter `tags:` value: each string entry is retargeted, and
 * an entry the note already carries under its new name is dropped rather than
 * duplicated. Accepts a list or a single string, the two shapes the indexer
 * reads (`flattenFrontmatterStrings`); non-string entries are kept as-is.
 */
export function rewriteFrontmatterTags(content: string, from: string, to: string): { content: string; changed: boolean } {
  const fm = readFrontmatterProperties(content);
  const tags = fm.tags;
  let next: unknown;
  if (typeof tags === 'string') {
    const moved = retargetTag(tags, from, to);
    if (moved === null) return { content, changed: false };
    next = moved;
  } else if (Array.isArray(tags)) {
    // Names the merge produces. Only a collision on one of these is the
    // merge's to resolve; a duplicate the user already had elsewhere in the
    // list is theirs and stays.
    const produced = new Set<string>();
    for (const t of tags) {
      if (typeof t !== 'string') continue;
      const moved = retargetTag(t, from, to);
      if (moved !== null) produced.add(moved);
    }
    if (produced.size === 0) return { content, changed: false };
    const seen = new Set<string>();
    const list: unknown[] = [];
    for (const t of tags) {
      if (typeof t !== 'string') { list.push(t); continue; }
      const name = retargetTag(t, from, to) ?? t;
      if (produced.has(name) && seen.has(name)) continue;
      seen.add(name);
      list.push(name);
    }
    next = list;
  } else {
    return { content, changed: false };
  }
  const result = patchFrontmatterProperties(content, { tags: next });
  return { content: result.content, changed: result.changedKeys.length > 0 };
}

/**
 * Merge `from` into `to` in one note: frontmatter `tags:` first, then inline
 * `#tags` (body, and any the indexer reads inside frontmatter text). Returns
 * the input unchanged when the note doesn't carry the tag.
 */
export function mergeTagInContent(content: string, from: string, to: string): { content: string; changed: boolean } {
  const fm = rewriteFrontmatterTags(content, from, to);
  const inline = rewriteInlineTags(fm.content, from, to);
  const changed = fm.changed || inline.count > 0;
  return { content: changed ? inline.content : content, changed };
}
