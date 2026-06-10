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
 * trailing bucket (`label: null`, rendered as "General"). If no tool in the
 * list declares a group, the result is a single null-labelled bucket — the
 * caller treats that as "render flat", preserving current behavior for
 * categories nobody has grouped (Learning, Research).
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
