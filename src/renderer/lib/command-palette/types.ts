/**
 * Command palette types (#463). A command represents a single
 * keyboard-driven action — what would otherwise be a menu item.
 * The palette and the menu are intended to draw from the same
 * registry over time; for v1 they live in parallel and the palette
 * surfaces the most-used subset.
 */

export interface Command {
  /** Stable id used as the recently-used storage key. Convention:
   *  `category.action`, e.g. `file.newNote`, `view.toggleSidebar`. */
  id: string;
  /** Human-readable label rendered in the palette and used for
   *  matching. Typically mirrors the menu's label. */
  title: string;
  /** Top-level grouping ("File", "View", "Refactor", …) shown as
   *  a muted secondary line so the user can disambiguate similar
   *  titles. */
  category: string;
  /** Pre-formatted display string for the bound shortcut (e.g.
   *  `"⌘ ⇧ N"`), or null when none. The palette right-aligns this. */
  keybinding: string | null;
  /** Pre-evaluated enabled state. Disabled commands still appear
   *  in the list but are greyed out and not pickable — keeps the
   *  palette's contents predictable across opens. */
  enabled: boolean;
  /** Invoke the command. May be async; the palette closes
   *  immediately after dispatch. */
  run: () => void | Promise<void>;
}
