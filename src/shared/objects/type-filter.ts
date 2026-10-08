/**
 * The Type filter's choices (#2716): a view type's subtypes as a tree, each
 * with how many of the view's instances it would keep. The matching itself is
 * `view-spec.ts`'s (the reserved `type` key); this is only what the filter bar
 * offers. Pure + cycle-safe.
 *
 * The view's own type is never a choice — an unfiltered view already shows
 * everything — so a type with no subtypes has no choices, and the bar doesn't
 * offer Type at all.
 */
import { inheritsFrom } from './inheritance';
import type { TypeInstanceRow } from './type-def';
import type { TypeLookup } from './view-spec';

export interface SubtypeChoice {
  id: string;
  label: string;
  icon?: string | undefined;
  /** 0 for a direct subtype, 1 for its subtypes, … — the tree's indent. */
  depth: number;
  /** Instances in `instances` whose own type is this one or below it. */
  count: number;
}

interface CatalogType { id: string; parent?: string | undefined; label?: string | undefined; icon?: string | undefined }

/**
 * `viewTypeId`'s subtypes, depth-first, siblings by label: Restaurant,
 * Pizzeria (depth 1), Museum. `instances` is the scope the counts are in (the
 * folder plus every other filter); `typeOf` gives a note's own type.
 */
export function subtypeChoices(
  viewTypeId: string,
  types: readonly CatalogType[],
  instances: readonly TypeInstanceRow[],
  typeOf: TypeLookup['typeOf'],
): SubtypeChoice[] {
  const byId = new Map(types.map((t) => [t.id, t] as const));
  const children = new Map<string, CatalogType[]>();
  for (const t of byId.values()) {
    if (!t.parent || t.id === t.parent) continue;
    const list = children.get(t.parent) ?? [];
    list.push(t);
    children.set(t.parent, list);
  }
  const labelOf = (t: CatalogType) => t.label ?? t.id;
  const own = instances.map((i) => typeOf(i.path)).filter((id): id is string => !!id);

  const out: SubtypeChoice[] = [];
  const visited = new Set<string>([viewTypeId]);
  const walk = (parentId: string, depth: number) => {
    const kids = [...(children.get(parentId) ?? [])].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    for (const t of kids) {
      if (visited.has(t.id)) continue; // a cycle
      visited.add(t.id);
      out.push({
        id: t.id,
        label: labelOf(t),
        icon: t.icon,
        depth,
        count: own.filter((id) => inheritsFrom(id, t.id, byId)).length,
      });
      walk(t.id, depth + 1);
    }
  };
  walk(viewTypeId, 0);
  return out;
}
