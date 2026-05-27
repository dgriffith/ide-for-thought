/**
 * Source collections (#470 phase 1 — manual, hierarchical).
 *
 * Zotero-style collections: named containers a researcher can drag a
 * source into, nested as a tree, with one source allowed in many
 * collections. This is organisational metadata, not a re-shaping of
 * the underlying source store on disk — sources still live at
 * `.minerva/sources/<id>/`.
 *
 * Storage: a single `.minerva/collections.json` file. Membership is
 * embedded per-collection (matches Zotero's mental model and keeps
 * "list members of X" trivial). Mutations are read-modify-write of
 * the whole file — collections per project are typically O(10–50),
 * so we don't need any of the contortions a graph-resident store
 * would have imposed.
 *
 * Smart collections (#470 phase 2) will live in the same file later,
 * with a separate top-level array — the manual side will not need to
 * change.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { SmartCollection, SmartCollectionPredicate } from '../../shared/types';

export interface Collection {
  id: string;
  name: string;
  /** Parent collection id, or null for a top-level collection. */
  parent: string | null;
  /** Source ids belonging to this collection. Order is preserved as
   *  the user adds them; the UI sorts on display. */
  members: string[];
}

export interface CollectionsFile {
  collections: Collection[];
  smartCollections: SmartCollection[];
}

function filePath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'collections.json');
}

/** Fresh empty file. Returned as a new object each call so callers
 *  can read-modify-write without any chance of leaking state into
 *  the next read. */
function emptyFile(): CollectionsFile {
  return { collections: [], smartCollections: [] };
}

/** Coerce an unknown into a SmartCollectionPredicate or null. Defensive
 *  load tolerates a missing/bad predicate by dropping the smart entry
 *  rather than guessing — the user's hand-edits get respected; a
 *  truly broken record vanishes from the sidebar instead of crashing. */
function parsePredicate(value: unknown): SmartCollectionPredicate | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { kind?: unknown; allOf?: unknown };
  if (v.kind === 'tags') {
    const allOf = Array.isArray(v.allOf) ? v.allOf.filter((t): t is string => typeof t === 'string') : [];
    return { kind: 'tags', allOf };
  }
  return null;
}

export async function loadCollections(rootPath: string): Promise<CollectionsFile> {
  try {
    const raw = await fs.readFile(filePath(rootPath), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return emptyFile();
    const collections = Array.isArray((parsed as CollectionsFile).collections)
      ? (parsed as CollectionsFile).collections
      : [];
    const smartCollections = Array.isArray((parsed as CollectionsFile).smartCollections)
      ? (parsed as CollectionsFile).smartCollections
      : [];
    return {
      // Defensive: any record with a missing field falls through to safe defaults.
      collections: collections.map((c) => ({
        id: String(c.id ?? ''),
        name: String(c.name ?? ''),
        parent: c.parent == null ? null : String(c.parent),
        members: Array.isArray(c.members) ? c.members.map((m) => String(m)) : [],
      })).filter((c) => c.id),
      smartCollections: smartCollections.map((s) => {
        const predicate = parsePredicate(s.predicate);
        if (!predicate) return null;
        const id = String(s.id ?? '');
        if (!id) return null;
        return { id, name: String(s.name ?? id), predicate };
      }).filter((s): s is SmartCollection => s !== null),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile();
    throw err;
  }
}

async function saveCollections(rootPath: string, data: CollectionsFile): Promise<void> {
  const p = filePath(rootPath);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Stable, human-readable id derived from the name. If a collision
 * exists, append `-2`, `-3`, … until unique. We don't generate UUIDs
 * here — when a user looks at `collections.json` they should be able
 * to spot which row is "Reading list" without cross-referencing.
 *
 * Manual + smart collections share the id namespace so the sidebar can
 * use a single `activeCollectionId` field without disambiguating by
 * kind on every read.
 */
function uniqueIdFor(name: string, taken: ReadonlySet<string>): string {
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'collection';
  if (!taken.has(slug)) return slug;
  for (let i = 2; ; i++) {
    const candidate = `${slug}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function takenIds(data: CollectionsFile): Set<string> {
  const out = new Set<string>();
  for (const c of data.collections) out.add(c.id);
  for (const s of data.smartCollections) out.add(s.id);
  return out;
}

export interface CreateCollectionArgs {
  name: string;
  parent?: string | null;
}

export async function createCollection(rootPath: string, args: CreateCollectionArgs): Promise<Collection> {
  const trimmed = args.name.trim();
  if (!trimmed) throw new Error('Collection name cannot be empty.');
  const data = await loadCollections(rootPath);
  if (args.parent && !data.collections.some((c) => c.id === args.parent)) {
    throw new Error(`Parent collection "${args.parent}" not found.`);
  }
  const collection: Collection = {
    id: uniqueIdFor(trimmed, takenIds(data)),
    name: trimmed,
    parent: args.parent ?? null,
    members: [],
  };
  data.collections.push(collection);
  await saveCollections(rootPath, data);
  return collection;
}

export async function renameCollection(rootPath: string, id: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Collection name cannot be empty.');
  const data = await loadCollections(rootPath);
  const target = data.collections.find((c) => c.id === id);
  if (!target) throw new Error(`Collection "${id}" not found.`);
  target.name = trimmed;
  await saveCollections(rootPath, data);
}

/**
 * Delete a collection. Its children are re-parented to root (less
 * destructive than cascade-delete; per CLAUDE.md no-fear UX, we don't
 * want a folder delete to silently take any nested folders with it).
 * Sources themselves are never touched — membership is the only thing
 * that disappears.
 */
export async function deleteCollection(rootPath: string, id: string): Promise<void> {
  const data = await loadCollections(rootPath);
  const before = data.collections.length;
  data.collections = data.collections
    .filter((c) => c.id !== id)
    .map((c) => (c.parent === id ? { ...c, parent: null } : c));
  if (data.collections.length === before) {
    throw new Error(`Collection "${id}" not found.`);
  }
  await saveCollections(rootPath, data);
}

export async function addSourceToCollection(
  rootPath: string,
  collectionId: string,
  sourceId: string,
): Promise<void> {
  const data = await loadCollections(rootPath);
  const target = data.collections.find((c) => c.id === collectionId);
  if (!target) throw new Error(`Collection "${collectionId}" not found.`);
  if (!target.members.includes(sourceId)) {
    target.members.push(sourceId);
    await saveCollections(rootPath, data);
  }
}

export async function removeSourceFromCollection(
  rootPath: string,
  collectionId: string,
  sourceId: string,
): Promise<void> {
  const data = await loadCollections(rootPath);
  const target = data.collections.find((c) => c.id === collectionId);
  if (!target) throw new Error(`Collection "${collectionId}" not found.`);
  const idx = target.members.indexOf(sourceId);
  if (idx >= 0) {
    target.members.splice(idx, 1);
    await saveCollections(rootPath, data);
  }
}

/**
 * Sweep every collection for membership entries pointing at the given
 * source id. Called by the source-delete and source-merge paths so a
 * removed source doesn't linger as a dead entry forever.
 */
export async function scrubSourceFromCollections(rootPath: string, sourceId: string): Promise<void> {
  const data = await loadCollections(rootPath);
  let mutated = false;
  for (const c of data.collections) {
    const before = c.members.length;
    c.members = c.members.filter((id) => id !== sourceId);
    if (c.members.length !== before) mutated = true;
  }
  if (mutated) await saveCollections(rootPath, data);
}

/**
 * When src is being merged into dest (#90 part 2), src's collection
 * memberships should follow it: any collection that contained src
 * should contain dest, and src itself should be scrubbed. Idempotent.
 *
 * Smart collections need no rewrite — their membership is derived
 * from the graph, which the merge already updated.
 */
export async function rewriteCollectionMemberships(
  rootPath: string,
  srcId: string,
  destId: string,
): Promise<void> {
  if (srcId === destId) return;
  const data = await loadCollections(rootPath);
  let mutated = false;
  for (const c of data.collections) {
    const hasSrc = c.members.includes(srcId);
    if (!hasSrc) continue;
    c.members = c.members.filter((id) => id !== srcId);
    if (!c.members.includes(destId)) c.members.push(destId);
    mutated = true;
  }
  if (mutated) await saveCollections(rootPath, data);
}

// ─── Smart collections (#470 phase 2) ────────────────────────────────────

export interface CreateSmartCollectionArgs {
  name: string;
  predicate: SmartCollectionPredicate;
}

export async function createSmartCollection(
  rootPath: string,
  args: CreateSmartCollectionArgs,
): Promise<SmartCollection> {
  const trimmed = args.name.trim();
  if (!trimmed) throw new Error('Smart collection name cannot be empty.');
  validatePredicate(args.predicate);
  const data = await loadCollections(rootPath);
  const smart: SmartCollection = {
    id: uniqueIdFor(trimmed, takenIds(data)),
    name: trimmed,
    predicate: args.predicate,
  };
  data.smartCollections.push(smart);
  await saveCollections(rootPath, data);
  return smart;
}

export async function renameSmartCollection(rootPath: string, id: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error('Smart collection name cannot be empty.');
  const data = await loadCollections(rootPath);
  const target = data.smartCollections.find((s) => s.id === id);
  if (!target) throw new Error(`Smart collection "${id}" not found.`);
  target.name = trimmed;
  await saveCollections(rootPath, data);
}

export async function deleteSmartCollection(rootPath: string, id: string): Promise<void> {
  const data = await loadCollections(rootPath);
  const before = data.smartCollections.length;
  data.smartCollections = data.smartCollections.filter((s) => s.id !== id);
  if (data.smartCollections.length === before) {
    throw new Error(`Smart collection "${id}" not found.`);
  }
  await saveCollections(rootPath, data);
}

export async function updateSmartCollectionPredicate(
  rootPath: string,
  id: string,
  predicate: SmartCollectionPredicate,
): Promise<void> {
  validatePredicate(predicate);
  const data = await loadCollections(rootPath);
  const target = data.smartCollections.find((s) => s.id === id);
  if (!target) throw new Error(`Smart collection "${id}" not found.`);
  target.predicate = predicate;
  await saveCollections(rootPath, data);
}

function validatePredicate(p: SmartCollectionPredicate): void {
  if (p.kind === 'tags') {
    if (!Array.isArray(p.allOf)) throw new Error('Tag predicate.allOf must be an array.');
    for (const t of p.allOf) {
      if (typeof t !== 'string' || !t.trim()) {
        throw new Error('Tag predicate.allOf must contain non-empty strings.');
      }
    }
    return;
  }
  // Exhaustiveness: the type union ensures the compiler catches missing
  // branches when new predicate kinds land.
  const _exhaustive: never = p.kind;
  throw new Error(`Unsupported predicate kind: ${_exhaustive as string}`);
}

/**
 * Compute the source ids that satisfy a smart-collection's predicate.
 *
 * Tags ALL-OF semantics: a source is a member iff its
 * `minerva:hasTag` edges include every tag in `allOf`. Empty `allOf`
 * matches nothing — a smart collection with no constraints is almost
 * certainly a half-edited mistake, and silently matching every
 * source would look like a bug.
 *
 * Resolved against the in-memory graph via `sourcesByTag` so we get
 * the same predicate semantics the tag panel uses.
 */
export function resolveSmartMembers(
  predicate: SmartCollectionPredicate,
  sourcesByTag: (tag: string) => ReadonlyArray<{ sourceId: string }>,
): Set<string> {
  if (predicate.kind === 'tags') {
    if (predicate.allOf.length === 0) return new Set();
    let acc: Set<string> | null = null;
    for (const tag of predicate.allOf) {
      const ids = new Set(sourcesByTag(tag).map((s) => s.sourceId));
      if (acc === null) {
        acc = ids;
      } else {
        for (const x of acc) if (!ids.has(x)) acc.delete(x);
      }
      if (acc.size === 0) break;
    }
    return acc ?? new Set();
  }
  const _exhaustive: never = predicate.kind;
  throw new Error(`Unsupported predicate kind: ${_exhaustive as string}`);
}
