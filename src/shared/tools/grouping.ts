/**
 * Thematic sub-grouping within a tool category (#525).
 *
 * When a category grows long (Analysis ships ~20 skills), a flat list is hard
 * to scan. Skills can declare an optional `group` (compiled to
 * `ThinkingToolDef.group`); this helper partitions an already-ordered tool list
 * into groups for the menu to render as nested submenus.
 *
 * Pure and order-preserving: groups appear in first-appearance order (which
 * follows the menu config's ordering), and ungrouped tools collect into a
 * trailing `label: null` bucket. Menus render named groups as nested submenus
 * and the ungrouped bucket *inline* (not as a "General" submenu), so grouping
 * one skill nests just that skill instead of restructuring the whole category.
 * If no tool in the list declares a group, the result is a single null-labelled
 * bucket — rendered flat, exactly as an ungrouped category (Learning, Research)
 * looks today.
 */

export interface GroupableTool {
  group?: string;
}

export interface ToolGroup<T> {
  /** The group name, or null for the ungrouped ("General") bucket. */
  label: string | null;
  tools: T[];
}

export function groupToolsByGroup<T extends GroupableTool>(tools: T[]): ToolGroup<T>[] {
  const named = new Map<string, T[]>(); // insertion order = first appearance
  const ungrouped: T[] = [];

  for (const tool of tools) {
    const g = tool.group;
    if (g) {
      const bucket = named.get(g);
      if (bucket) bucket.push(tool);
      else named.set(g, [tool]);
    } else {
      ungrouped.push(tool);
    }
  }

  // No named groups → a single flat bucket the caller renders inline.
  if (named.size === 0) return [{ label: null, tools: ungrouped }];

  const out: ToolGroup<T>[] = [...named].map(([label, ts]) => ({ label, tools: ts }));
  if (ungrouped.length > 0) out.push({ label: null, tools: ungrouped });
  return out;
}

/** True when the partition warrants nested submenus (≥1 named group). */
export function hasNamedGroups<T>(groups: ToolGroup<T>[]): boolean {
  return groups.some((g) => g.label !== null);
}

/**
 * Flatten a partition for a menu that nests each named group into a submenu but
 * keeps ungrouped tools inline, in place. `submenu(label, tools)` builds a
 * nested item; ungrouped tools are emitted individually via `flat(tool)`.
 *
 * This is what makes grouping *local*: adding a `group` to one skill nests only
 * that skill, leaving every ungrouped skill exactly where it was — instead of
 * collecting them all into a "General" submenu. With no named groups the whole
 * list is one ungrouped bucket, so every tool renders flat.
 */
export function flattenGroupedMenu<T, R>(
  groups: ToolGroup<T>[],
  flat: (tool: T) => R,
  submenu: (label: string, tools: T[]) => R,
): R[] {
  return groups.flatMap((g) => (g.label ? [submenu(g.label, g.tools)] : g.tools.map(flat)));
}
