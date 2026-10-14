/**
 * The note actions a view's row menu offers (#2773, epic #2769): what the
 * host does with them, and what each submenu lists for a selection. The view
 * writes nothing itself (#2431) — it hands the selected paths to these.
 */
import type { PropertyDef, TypeInstanceRow } from '../../../../shared/objects/type-def';
import { normalizeTag } from '../../../../shared/objects/view-spec';

/** What the host does for a selection — App wires them to refactor-ops. */
export interface TypeViewNoteActions {
  /** The bulk property panel; `only` narrows it to one property (Set Property ▸). */
  editProperties: (paths: string[], only?: string) => void;
  addTag: (paths: string[]) => void;
  /** No `tag` → prompt with the notes' own tags (a referenced note, #2775). */
  removeTag: (paths: string[], tag?: string) => void;
  clearProperty: (paths: string[], name: string) => void;
}

export interface MenuChoice { key: string; label: string; count: number }

const pick = (instances: readonly TypeInstanceRow[], paths: readonly string[]) => {
  const wanted = new Set(paths);
  return instances.filter((i) => wanted.has(i.path));
};

/** Remove Tag ▸: the tags the selection carries, folded by case, with how many notes have each. */
export function selectionTags(instances: readonly TypeInstanceRow[], paths: readonly string[]): MenuChoice[] {
  const byKey = new Map<string, MenuChoice>();
  for (const inst of pick(instances, paths)) {
    for (const tag of inst.tags ?? []) {
      const key = normalizeTag(tag);
      const seen = byKey.get(key);
      if (seen) seen.count++;
      else byKey.set(key, { key: tag.replace(/^#/, ''), label: `#${tag.replace(/^#/, '')}`, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Clear Property ▸: the declared properties the selection has set, with how many notes set each. */
export function selectionSetProperties(
  instances: readonly TypeInstanceRow[],
  paths: readonly string[],
  properties: readonly PropertyDef[],
): MenuChoice[] {
  const rows = pick(instances, paths);
  return properties
    .map((p) => ({
      key: p.name,
      label: p.label ?? p.name,
      count: rows.filter((r) => { const v = r.values[p.name]; return v !== null && v !== undefined && v !== ''; }).length,
    }))
    .filter((c) => c.count > 0);
}
