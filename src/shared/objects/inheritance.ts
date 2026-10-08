/**
 * Subclass property inheritance (#1587). A type's *effective* declared
 * properties are its ancestors' properties (root-first) plus its own, with the
 * child overriding an ancestor's property of the same name in place. Pure +
 * cycle-safe (a `visited` set), so the read-back (#1063), the multi-view
 * projection (#1070), and the property form (#1066) all derive the same list.
 */
import { toTypeInfo, type PropertyDef, type TypeDef, type TypeInfo } from './type-def';

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

/**
 * A type's *effective* default body (#2494): its own template if it has one,
 * else the nearest ancestor's that does. Nearest-wins rather than composing
 * parent + child — a composed body has no obvious order or join, and a child
 * that wants its parent's text can copy it. Same cycle-safe walk as
 * `effectivePropertyDefs`. `undefined` when no type in the chain has a body.
 */
export function effectiveTemplate(
  typeId: string,
  byId: ReadonlyMap<string, TypeLike & { template?: string | undefined }>,
): { template: string; fromTypeId: string } | undefined {
  const visited = new Set<string>();
  let cur = byId.get(typeId);
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    if (cur.template && cur.template.trim()) return { template: cur.template, fromTypeId: cur.id };
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return undefined;
}

/**
 * `toTypeInfo` plus the views that need the whole catalog: the effective
 * default body (#2494) and the effective property names a template's
 * placeholders may name (#2490). What the renderer and the LLM should get
 * wherever a catalog is at hand.
 */
export function toTypeInfoWithInheritance(t: TypeDef, byId: ReadonlyMap<string, TypeDef>): TypeInfo {
  const inherited = effectiveTemplate(t.id, byId);
  return {
    ...toTypeInfo(t),
    effectiveTemplate: inherited?.template,
    templateFrom: inherited?.fromTypeId,
    effectivePropertyNames: effectivePropertyDefs(t.id, byId).map((p) => p.name),
  };
}

/**
 * Is `typeId` the type `ancestorId` or one of its descendants (#2607)? Walks
 * `parent` through `byId` with the same cycle-safe walk as
 * `effectivePropertyDefs`, so a subtype of a subtype counts. False for a type
 * `byId` doesn't have, and for a chain that breaks before reaching it.
 */
export function inheritsFrom(
  typeId: string,
  ancestorId: string,
  byId: ReadonlyMap<string, Pick<TypeLike, 'id' | 'parent'>>,
): boolean {
  const visited = new Set<string>();
  let cur = byId.get(typeId);
  while (cur && !visited.has(cur.id)) {
    if (cur.id === ancestorId) return true;
    visited.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return false;
}

/**
 * `typeId`'s effective properties when the catalog SETTLES them, else null:
 * `types` null, a catalog without `typeId`, or a `parent` chain that leaves
 * the catalog before it ends (a subtype whose ancestors haven't loaded yet).
 * A cycle settles them — `effectivePropertyDefs` stops there too. What a view
 * spec's judgements (`timelineSpecForType`, `calendarSpecForType`) read, so a
 * half-loaded catalog keeps a spec as written instead of judging it (#2701,
 * #2715).
 */
export function settledPropertyDefs(typeId: string, types: readonly TypeLike[] | null): PropertyDef[] | null {
  if (types === null) return null;
  const byId = new Map(types.map((t) => [t.id, t] as const));
  const visited = new Set<string>();
  let cur = byId.get(typeId);
  if (!cur) return null;
  while (!visited.has(cur.id)) {
    visited.add(cur.id);
    if (!cur.parent) break;
    const next = byId.get(cur.parent);
    if (!next) return null; // the chain leaves the catalog: not known yet
    cur = next;
  }
  return effectivePropertyDefs(typeId, byId);
}
