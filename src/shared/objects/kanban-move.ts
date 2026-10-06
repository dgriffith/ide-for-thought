/**
 * Moving a card on a Kanban board (#2603, epic #2600) — the pure half.
 *
 * - **`setGroupValue`** is the write: ONE frontmatter field set to the target
 *   column's value, or removed for **No value**. It goes through the bulk
 *   editor's span-splicing writer (`applyBulkEdits`, built on the shared
 *   `frontmatter-rows` helpers, #1596), so only the grouping key's own lines
 *   change. Every other key, comment, blank line, the key order and the body
 *   stay byte-identical, and a card dropped where it already is changes
 *   nothing at all.
 * - **`moveTargets`** is what *Move to ▸* lists: every column the card could
 *   go to. That's every declared option (an empty column is still somewhere to
 *   put a card, and a values filter that hides a column doesn't make it less
 *   real), any off-list value the board shows, and **No value**.
 * - **`groupValueOf`** reads the field back, for the undo check.
 */
import { applyBulkEdits, scalarTextOf } from './bulk-properties';
import { parseFrontmatter } from '../refactor/frontmatter-rows';
import { NO_VALUE_LABEL, type KanbanColumn, type KanbanColumnKind } from './kanban';
import type { PropertyDef } from './type-def';

/** Where a card goes: a column's value (null = No value) and heading. */
export interface MoveTarget {
  value: string | null;
  label: string;
  kind: KanbanColumnKind;
}

/**
 * Set `property` to `value` in a note's frontmatter, or remove it when
 * `value` is null. Returns the new content (`changed: false` and the input
 * unchanged when the note already says that), or null when the frontmatter
 * doesn't parse, so the caller reports it instead of overwriting the user's
 * YAML.
 */
export function setGroupValue(content: string, property: string, value: string | null): { content: string; changed: boolean } | null {
  return applyBulkEdits(content, [value === null ? { op: 'clear', key: property } : { op: 'set', key: property, value }]);
}

/**
 * The grouping field's current value as the board reads it: its text, or null
 * when the note leaves it empty (absent, blank, or a shape that isn't one
 * value). Undefined when the frontmatter doesn't parse.
 */
export function groupValueOf(content: string, property: string): string | null | undefined {
  const parsed = parseFrontmatter(content);
  if (!parsed.ok) return undefined;
  if ('none' in parsed) return null;
  const row = parsed.rows.find((r) => r.key === property);
  const text = row ? scalarTextOf(row.shape) : undefined;
  return text === undefined || text === '' ? null : text;
}

/** *Move to ▸*'s columns: the declared options, the board's off-list columns, then No value. */
export function moveTargets(group: PropertyDef, columns: readonly KanbanColumn[]): MoveTarget[] {
  const targets: MoveTarget[] = (group.options ?? []).map((o) => ({ value: o, label: o, kind: 'option' as const }));
  const seen = new Set(group.options ?? []);
  for (const col of columns) {
    if (col.kind !== 'off-list' || col.value === null || seen.has(col.value)) continue;
    seen.add(col.value);
    targets.push({ value: col.value, label: col.label, kind: 'off-list' });
  }
  targets.push({ value: null, label: NO_VALUE_LABEL, kind: 'no-value' });
  return targets;
}

/** The target a board column stands for (a drop on it). */
export function targetOfColumn(value: string, kind: string): MoveTarget {
  if (kind === 'no-value' || value === '') return { value: null, label: NO_VALUE_LABEL, kind: 'no-value' };
  return { value, label: value, kind: kind === 'off-list' ? 'off-list' : 'option' };
}

/** The column value every one of `paths` is in (null = No value), or
 *  undefined when they're in different columns or none is on the board —
 *  *Move to ▸* disables that column. */
export function sharedColumnValue(columns: readonly KanbanColumn[], paths: readonly string[]): string | null | undefined {
  const values = new Set<string | null>();
  for (const p of paths) {
    const col = columns.find((c) => c.instances.some((i) => i.path === p));
    if (!col) return undefined;
    values.add(col.value);
  }
  return values.size === 1 ? [...values][0] : undefined;
}
