/**
 * Subclass property inheritance (#1587). A type's *effective* declared
 * properties are its ancestors' properties (root-first) plus its own, with the
 * child overriding an ancestor's property of the same name in place. Pure +
 * cycle-safe (a `visited` set), so the read-back (#1063), the multi-view
 * projection (#1070), and the property form (#1066) all derive the same list.
 */
import type { PropertyDef } from './type-def';

export interface TypeLike {
  id: string;
  parent?: string | undefined;
  properties: PropertyDef[];
}

export function effectivePropertyDefs(
  typeId: string,
  byId: ReadonlyMap<string, TypeLike>,
): PropertyDef[] {
  // Walk parent → root, collecting the chain root-first; stop on a cycle.
  const chain: TypeLike[] = [];
  const visited = new Set<string>();
  let cur = byId.get(typeId);
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  // Insertion order = ancestor props first; a same-name child prop overrides the
  // value while keeping the ancestor's position; genuinely new child props append.
  const byName = new Map<string, PropertyDef>();
  for (const t of chain) for (const p of t.properties) byName.set(p.name, p);
  return [...byName.values()];
}
