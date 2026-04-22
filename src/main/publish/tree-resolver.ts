/**
 * Note-tree resolver for bundle exports (#251).
 *
 * BFS from a root note through outbound wiki-links, bounded by depth,
 * de-duplicating cycles, and respecting the private-by-default exclusion
 * rules from #246. Returns the ordered manifest the tree exporter feeds
 * into the per-note renderer, plus an audit of what got excluded and
 * which links couldn't be resolved.
 *
 * Pure — accepts pluggable `readFile`, `extractLinks`, and `isExcluded`
 * functions so tests exercise the algorithm without the filesystem and
 * the production flow wires in real implementations.
 */

export interface TreeResolveOptions {
  /** Relative path to the root note the user selected. */
  rootNote: string;
  /** 0 = root only; default 3 everywhere else this module is called. */
  maxDepth: number;
  /** Pull every plain wiki-link target out of a note's content. `cite::` / `quote::` should be omitted. */
  extractLinks: (content: string) => string[];
  /**
   * Read a note's raw content by relative path (as-written in the
   * source's wiki-links). Returns null when the path doesn't resolve
   * to a real file — the resolver records it as unresolved rather
   * than throwing.
   */
  readFile: (relativePath: string) => Promise<string | null>;
  /** Exclusion check — private-folder / frontmatter / tag rules from #246. */
  isExcluded: (relativePath: string, content: string) => { excluded: boolean; reason?: string };
}

export interface ResolvedTreeEntry {
  relativePath: string;
  depth: number;
  content: string;
}

export interface ResolvedTreeExclusion {
  relativePath: string;
  reason: string;
  depth: number;
}

export interface ResolvedTree {
  /** Root first, then BFS order. One entry per unique relative path. */
  included: ResolvedTreeEntry[];
  /** Notes reached but dropped by the exclusion rules. Depth-annotated for the audit. */
  excluded: ResolvedTreeExclusion[];
  /**
   * Wiki-link targets that didn't resolve to a real file. Common on
   * stub-linked notes ("[[future-work]]") — listed but non-fatal.
   */
  unresolved: string[];
}

/**
 * Run the BFS. Works over abstract string paths; see `normalizeTarget`
 * for the convention used to turn wiki-link targets ("notes/foo",
 * "foo.md") into the canonical form the filesystem sees ("notes/foo.md").
 */
export async function resolveTree(opts: TreeResolveOptions): Promise<ResolvedTree> {
  const visited = new Set<string>();
  const included: ResolvedTreeEntry[] = [];
  const excluded: ResolvedTreeExclusion[] = [];
  const unresolved: string[] = [];

  interface QueueEntry { path: string; depth: number }
  const queue: QueueEntry[] = [{ path: normalizeTarget(opts.rootNote), depth: 0 }];

  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) break;
    if (visited.has(entry.path)) continue;
    visited.add(entry.path);

    const content = await opts.readFile(entry.path);
    if (content == null) {
      // The root not existing is fatal; downstream paths are just missing links.
      if (entry.depth === 0) {
        throw new Error(`Tree root "${opts.rootNote}" not found.`);
      }
      unresolved.push(entry.path);
      continue;
    }

    const check = opts.isExcluded(entry.path, content);
    if (check.excluded) {
      excluded.push({
        relativePath: entry.path,
        reason: check.reason ?? 'excluded',
        depth: entry.depth,
      });
      continue;
    }

    included.push({ relativePath: entry.path, depth: entry.depth, content });

    if (entry.depth >= opts.maxDepth) continue;

    const links = opts.extractLinks(content);
    for (const raw of links) {
      const target = normalizeTarget(raw);
      if (!target) continue;
      if (visited.has(target)) continue;
      // Queueing a path we've already enqueued but not yet visited
      // is harmless — the `visited` check at dequeue time filters it.
      queue.push({ path: target, depth: entry.depth + 1 });
    }
  }

  return { included, excluded, unresolved };
}

/**
 * Turn a wiki-link target into the canonical relative path we use
 * throughout the pipeline: `.md`-suffixed, forward-slashed, no
 * leading `./`. Anchor and display fragments are stripped by the
 * caller's `extractLinks`; we tolerate stragglers anyway.
 */
export function normalizeTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Drop any anchor the caller didn't strip.
  const hashIdx = trimmed.indexOf('#');
  const noAnchor = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  // Normalise slashes + ensure `.md` suffix.
  const unified = noAnchor.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!unified) return '';
  return unified.toLowerCase().endsWith('.md') ? unified : `${unified}.md`;
}

/**
 * Wiki-link extractor tuned for the tree resolver's needs: returns only
 * the *target* portion of every `[[…]]` match that isn't a `cite::` or
 * `quote::` reference. Typed prefixes (`references::foo`) are stripped.
 * Anchors (`#section`) dropped. Display text (`|label`) dropped.
 *
 * Lives here (not in the resolver itself) so it's reusable by the
 * exporter's dry-run path and by the dialog's preview.
 */
export function extractWikiLinkTargets(content: string): string[] {
  const out: string[] = [];
  // Strip frontmatter so `derived_from: "[[…]]"` in a note's YAML
  // still contributes the link — we include frontmatter wiki-links
  // deliberately, because that's how derived notes trace back.
  const WIKI_RE = /\[\[([^\]|\n]+?)(?:\|[^\]\n]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = WIKI_RE.exec(content)) !== null) {
    const inner = m[1].trim();
    if (/^(cite|quote)::/i.test(inner)) continue;
    const untyped = inner.replace(/^[a-z][a-z0-9_]*::/i, '');
    const hashIdx = untyped.indexOf('#');
    const target = (hashIdx >= 0 ? untyped.slice(0, hashIdx) : untyped).trim();
    if (target) out.push(target);
  }
  return out;
}
