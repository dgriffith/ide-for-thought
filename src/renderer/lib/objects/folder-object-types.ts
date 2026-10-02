/**
 * Which object types a folder holds (#2532) — the Notes sidebar's
 * "View Objects ▸" submenu. Every type a note under the folder (recursively)
 * declares, plus the types it inherits from: a folder of restaurants offers
 * Restaurant and Place, because a Place view includes its subtypes'
 * instances. Each type's count is what its view would show — a parent counts
 * its subtypes' notes too. Direct types come first, then inherited ones, each
 * group by label. Pure: the caller supplies the note list and type lookups.
 */
import { inFolder } from '../../../shared/objects/view-spec';
import type { TypeInfo } from '../../../shared/objects/type-def';

export interface FolderObjectType {
  type: TypeInfo;
  count: number;
  /** A note here declares this type itself (vs. only a subtype of it). */
  direct: boolean;
}

export function objectTypesInFolder(
  folder: string,
  notePaths: readonly string[],
  typeForNote: (path: string) => TypeInfo | null,
  types: readonly TypeInfo[],
): FolderObjectType[] {
  const byId = new Map(types.map((t) => [t.id, t]));
  const counts = new Map<string, { type: TypeInfo; count: number; direct: boolean }>();
  for (const path of notePaths) {
    if (!inFolder(path, folder)) continue;
    const own = typeForNote(path);
    if (!own) continue;
    const seen = new Set<string>();
    for (let t: TypeInfo | undefined = own, depth = 0; t && !seen.has(t.id) && depth < 32; t = t.parent ? byId.get(t.parent) : undefined, depth++) {
      seen.add(t.id); // a cyclic `parent` chain can't loop forever
      const entry = counts.get(t.id) ?? { type: t, count: 0, direct: false };
      entry.count++;
      if (t.id === own.id) entry.direct = true;
      counts.set(t.id, entry);
    }
  }
  return [...counts.values()].sort((a, b) =>
    a.direct === b.direct ? a.type.label.localeCompare(b.type.label) : a.direct ? -1 : 1);
}
