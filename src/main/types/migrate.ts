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

/** Rewrite `type:` on each note to `toTypeId`, or REMOVE the key when null.
 *  Reads current content (edits since aren't clobbered), writes + reindexes. */
async function retypeNotes(rootPath: string, paths: string[], toTypeId: string | null): Promise<string[]> {
  const ctx = projectContext(rootPath);
  const rewritten: string[] = [];
  for (const p of paths) {
    let content: string;
    try { content = await notebaseFs.readFile(rootPath, p); } catch { continue; }
    const { content: next, changedKeys } = patchFrontmatterProperties(content, { type: toTypeId });
    if (changedKeys.length === 0) continue;
    await notebaseFs.writeFile(rootPath, p, next);
    await graph.indexNote(ctx, p, next);
    rewritten.push(p);
  }
  return rewritten;
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

export interface DeleteTypeResult { cleared: string[] }

/** Delete a user type; optionally clear `type:` from its instances first so they
 *  aren't left pointing at a type that no longer resolves. */
export async function deleteTypeSafely(rootPath: string, id: string, clearInstances: boolean): Promise<DeleteTypeResult> {
  const ctx = projectContext(rootPath);
  let cleared: string[] = [];
  if (clearInstances) {
    const def = (await loadTypeCatalog(rootPath)).types.find((t) => t.id === id);
    if (def) cleared = await retypeNotes(rootPath, await directInstancePaths(rootPath, def.classLocalName), null);
  }
  await deleteType(rootPath, id);
  await graph.reloadTypeCatalog(ctx);
  return { cleared };
}

export interface RenameTypeResult { newId: string; migrated: string[] }

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
    return { newId: oldId, migrated: [] };
  }

  // Capture instances BEFORE the class changes, write the new type so its class
  // exists, migrate, then remove the old.
  const paths = await directInstancePaths(rootPath, def.classLocalName);
  await saveType(rootPath, inputFromDef(def, newLabel, newId));
  await graph.reloadTypeCatalog(ctx);
  const migrated = await retypeNotes(rootPath, paths, newId);
  await deleteType(rootPath, oldId);
  await graph.reloadTypeCatalog(ctx);
  return { newId, migrated };
}
