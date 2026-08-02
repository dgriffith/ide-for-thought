/**
 * Type rename/delete safety (#1588) — don't silently orphan notes when a type
 * changes. Deleting can clear the `type:` from its instances; renaming can
 * migrate them to the new id. Both are user-initiated frontmatter rewrites
 * (direct writes, like the promote flow — no approval engine), each followed by
 * a catalog reload so the surfaces reflect the change at once.
 */
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { patchFrontmatterProperties } from '../../shared/refactor/frontmatter-patch';
import { loadTypeCatalog } from './loader';
import { saveType, deleteType, slugify, type SaveTypeInput } from './write';
import type { TypeDef } from '../../shared/objects/type-def';

/** Direct-instance note paths of a type class (its own instances, not a
 *  subclass's — those carry the subclass's `type:`, not this one). */
async function directInstancePaths(rootPath: string, classLocalName: string): Promise<string[]> {
  const { results } = await graph.queryGraph(
    projectContext(rootPath),
    `SELECT ?path WHERE { ?n a types:${classLocalName} ; minerva:relativePath ?path }`,
  );
  return (results as Array<{ path?: string }>).map((r) => r.path).filter((p): p is string => !!p);
}

/** A note that couldn't be re-typed (a write/index error), with the reason —
 *  surfaced so the caller can report a partial result instead of a bare throw. */
export interface RetypeFailure {
  /** Project-relative note path. */
  path: string;
  error: string;
}

interface RetypeResult {
  /** Notes whose `type:` was actually rewritten to disk. */
  rewritten: string[];
  failed: RetypeFailure[];
}

/** Rewrite `type:` on each note to `toTypeId`, or REMOVE the key when null.
 *  Reads current content (edits since aren't clobbered), writes + reindexes.
 *
 *  A single note's failure must not abort the batch or leave the returned list
 *  lying about what persisted (#1611): each note is isolated, and only a note
 *  that actually reached disk is reported as `rewritten` — the rest come back in
 *  `failed` for the caller to surface. */
async function retypeNotes(rootPath: string, paths: string[], toTypeId: string | null): Promise<RetypeResult> {
  const ctx = projectContext(rootPath);
  const rewritten: string[] = [];
  const failed: RetypeFailure[] = [];
  for (const p of paths) {
    let content: string;
    // A note that vanished between the query and now has nothing to migrate.
    try { content = await notebaseFs.readFile(rootPath, p); } catch { continue; }
    const { content: next, changedKeys } = patchFrontmatterProperties(content, { type: toTypeId });
    if (changedKeys.length === 0) continue;
    try {
      await notebaseFs.writeFile(rootPath, p, next);
      await graph.indexNote(ctx, p, next);
      rewritten.push(p);
    } catch (e) {
      failed.push({ path: p, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { rewritten, failed };
}

/** Full-fidelity save input for re-writing a type under a (possibly new) id. */
function inputFromDef(def: TypeDef, label: string, id: string): SaveTypeInput {
  return {
    label,
    id,
    properties: def.properties,
    ...(def.icon ? { icon: def.icon } : {}),
    ...(def.color ? { color: def.color } : {}),
    ...(def.cover ? { cover: def.cover } : {}),
    ...(def.card ? { card: def.card } : {}),
    ...(def.parent ? { parent: def.parent } : {}),
    ...(def.template ? { template: def.template } : {}),
  };
}

export interface DeleteTypeResult { cleared: string[]; failed: RetypeFailure[] }

/** Delete a user type; optionally clear `type:` from its instances first so they
 *  aren't left pointing at a type that no longer resolves. The delete is the
 *  user's explicit intent, so it proceeds even if some instances couldn't be
 *  cleared — those come back in `failed` (they still carry the old `type:`). */
export async function deleteTypeSafely(rootPath: string, id: string, clearInstances: boolean): Promise<DeleteTypeResult> {
  const ctx = projectContext(rootPath);
  let cleared: string[] = [];
  let failed: RetypeFailure[] = [];
  if (clearInstances) {
    const def = (await loadTypeCatalog(rootPath)).types.find((t) => t.id === id);
    if (def) {
      const res = await retypeNotes(rootPath, await directInstancePaths(rootPath, def.classLocalName), null);
      cleared = res.rewritten;
      failed = res.failed;
    }
  }
  await deleteType(rootPath, id);
  await graph.reloadTypeCatalog(ctx);
  return { cleared, failed };
}

export interface RenameTypeResult { newId: string; migrated: string[]; failed: RetypeFailure[] }

/** Rename a user type. A label-only change (same slug) just re-labels in place;
 *  an id change writes the new type, migrates its instances' `type:` to the new
 *  id, then drops the old file. */
export async function renameType(rootPath: string, oldId: string, newLabel: string): Promise<RenameTypeResult> {
  const ctx = projectContext(rootPath);
  const def = (await loadTypeCatalog(rootPath)).types.find((t) => t.id === oldId);
  if (!def) throw new Error(`type "${oldId}" not found`);
  const newId = slugify(newLabel);
  if (!newId) throw new Error('new name is empty');

  if (newId === oldId) {
    await saveType(rootPath, inputFromDef(def, newLabel, oldId));
    await graph.reloadTypeCatalog(ctx);
    return { newId: oldId, migrated: [], failed: [] };
  }

  // Capture instances BEFORE the class changes, write the new type so its class
  // exists, migrate, then remove the old.
  const paths = await directInstancePaths(rootPath, def.classLocalName);
  await saveType(rootPath, inputFromDef(def, newLabel, newId));
  await graph.reloadTypeCatalog(ctx);
  const { rewritten: migrated, failed } = await retypeNotes(rootPath, paths, newId);
  // Only retire the old type once EVERY instance has moved. If any failed, the
  // old type must stay so those notes still resolve — dropping it now would
  // orphan them, the exact harm #1588 prevents (#1611).
  if (failed.length === 0) await deleteType(rootPath, oldId);
  await graph.reloadTypeCatalog(ctx);
  return { newId, migrated, failed };
}
