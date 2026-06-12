/**
 * Pure collection-tree algorithms for SourcesPanel (#672).
 *
 * Extracted from the component's `$derived.by` blocks so the tree logic — which
 * is easy to get subtly wrong (cycles, deep nesting, subtree-rooted counts,
 * display ordering) — lives in one testable place. The component just wires its
 * reactive state into these.
 */

import type { Collection, SourceMetadata } from '../../../shared/types';
import { displaySourceTitle } from '../../../shared/source-display';

export interface CollectionRow {
  collection: Collection;
  depth: number;
  hasChildren: boolean;
}

/**
 * The focused manual collection plus every descendant — selecting a parent
 * shows everything filed under it (Zotero's "include child collections"
 * default). Returns null when nothing is focused or the focus is a smart
 * collection (which has no subtree).
 */
export function collectionSubtree(
  activeId: string | null,
  isSmart: boolean,
  collections: Collection[],
): Set<string> | null {
  if (!activeId || isSmart) return null;
  const out = new Set<string>([activeId]);
  let added = true;
  while (added) {
    added = false;
    for (const c of collections) {
      if (c.parent && out.has(c.parent) && !out.has(c.id)) {
        out.add(c.id);
        added = true;
      }
    }
  }
  return out;
}

/** Union of member source-ids across every manual collection in `subtree`. */
export function membersInSubtree(subtree: Set<string>, collections: Collection[]): Set<string> {
  const out = new Set<string>();
  for (const c of collections) {
    if (subtree.has(c.id)) for (const m of c.members) out.add(m);
  }
  return out;
}

/**
 * Per-collection visible counts — each reflects the subtree-rooted membership
 * a user would see clicking that row (i.e. includes descendants). Memoized per
 * id during the walk so a wide/deep tree stays linear.
 */
export function subtreeCounts(collections: Collection[]): Map<string, number> {
  const childrenOf = new Map<string | null, string[]>();
  for (const c of collections) {
    const arr = childrenOf.get(c.parent) ?? [];
    arr.push(c.id);
    childrenOf.set(c.parent, arr);
  }
  const subtreeMembers = new Map<string, Set<string>>();
  const collect = (id: string): Set<string> => {
    const cached = subtreeMembers.get(id);
    if (cached) return cached;
    const own = collections.find((c) => c.id === id);
    const out = new Set<string>(own?.members ?? []);
    for (const childId of childrenOf.get(id) ?? []) {
      for (const m of collect(childId)) out.add(m);
    }
    subtreeMembers.set(id, out);
    return out;
  };
  const result = new Map<string, number>();
  for (const c of collections) result.set(c.id, collect(c.id).size);
  return result;
}

/** Display-order flattening of the tree, honouring expansion state. Siblings
 *  are sorted by name; collapsed nodes hide their descendants. */
export function flattenCollectionRows(
  collections: Collection[],
  expanded: Record<string, boolean>,
): CollectionRow[] {
  const childrenOf = new Map<string | null, Collection[]>();
  for (const c of collections) {
    const arr = childrenOf.get(c.parent) ?? [];
    arr.push(c);
    childrenOf.set(c.parent, arr);
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  const out: CollectionRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of childrenOf.get(parent) ?? []) {
      const hasChildren = (childrenOf.get(c.id)?.length ?? 0) > 0;
      out.push({ collection: c, depth, hasChildren });
      if (hasChildren && expanded[c.id]) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Filter sources by active membership (null = no membership filter) and a
 * free-text query matched against title / byline / year / id.
 */
export function filterSources(
  sources: SourceMetadata[],
  activeMembers: Set<string> | null,
  query: string,
): SourceMetadata[] {
  let base = sources;
  if (activeMembers) base = base.filter((s) => activeMembers.has(s.sourceId));
  const q = query.trim().toLowerCase();
  if (!q) return base;
  return base.filter((s) => {
    const title = displaySourceTitle(s).toLowerCase();
    const byline = s.creators.join(' ').toLowerCase();
    const year = s.year ?? '';
    return title.includes(q) || byline.includes(q) || year.includes(q) || s.sourceId.includes(q);
  });
}
