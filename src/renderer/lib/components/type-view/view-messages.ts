/**
 * What a view says in place of its rows. Pure, out of `TypeView` so the
 * wording lives beside its rules.
 *
 * - `emptyScopedMessage`: nothing in scope — the folder, the filters, or both.
 * - `lostLayoutLine` (#2946): a query's columns decide its layouts, and a
 *   query whose data no longer has what a layout needs (its location column
 *   went, say) shows the table instead, with this line — the layout's
 *   registry entry says what it `needs`. A type's layouts are
 *   judged when its spec is read (`timelineSpecForType` and friends); a
 *   query's schema is inferred on every run, so it's judged here.
 */
import type { ViewLayout } from '../../../../shared/types';
import { layoutDef } from '../../../../shared/objects/view-layouts';

export function emptyScopedMessage(label: string, folder: string | null, filtered: boolean): string {
  const what = label.toLowerCase();
  if (filtered) return folder ? `No ${what} in ${folder} match these filters.` : `No ${what} match these filters.`;
  return `No ${what} in ${folder}.`;
}

/** "This query no longer has a location column, so it's shown as a table." */
export function lostLayoutLine(layout: ViewLayout): string {
  return `This query no longer has ${layoutDef(layout).needs ?? 'what that layout needs'}, so it's shown as a table.`;
}
