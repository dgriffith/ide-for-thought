/**
 * Multi-selection state for the left sidebar's file tree.
 *
 * Designed for selection-driven actions ("Format" runs on whatever's
 * selected) — the alternative was a fan of pre-baked-scope commands
 * (Format Current Note / Format Folder / Format All) which doesn't
 * generalise.
 *
 * Mouse interactions follow the Finder / VS Code convention:
 *   plain click       → set single selection, open the file
 *   ⌘-click / ctrl    → toggle path in selection, do NOT open
 *   shift-click       → range from anchor to clicked path (visible
 *                       order), do NOT open
 *   ⌘A / ctrl-A       → select every visible file
 *   Escape            → clear
 *
 * Selection holds project-relative paths (files OR directories).
 * Action handlers expand directories to their contained files via a
 * helper at use-site.
 */

let selected = $state<Set<string>>(new Set());
let anchor = $state<string | null>(null);

export function getSidebarSelectionStore() {
  function clear(): void {
    selected = new Set();
    anchor = null;
  }

  function setSingle(path: string): void {
    selected = new Set([path]);
    anchor = path;
  }

  function toggle(path: string): void {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    selected = next;
    anchor = path;
  }

  /**
   * Replace the selection with the range between the current anchor
   * and `path` (inclusive), in `visibleOrder` (a flat list of every
   * currently-visible row in tree-display order). When no anchor
   * exists, falls back to a single-selection.
   */
  function selectRange(path: string, visibleOrder: string[]): void {
    if (anchor === null) {
      setSingle(path);
      return;
    }
    const fromIdx = visibleOrder.indexOf(anchor);
    const toIdx = visibleOrder.indexOf(path);
    if (fromIdx === -1 || toIdx === -1) {
      setSingle(path);
      return;
    }
    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    selected = new Set(visibleOrder.slice(lo, hi + 1));
    // Anchor stays fixed during a range select — extending the shift
    // click again should grow/shrink from the same anchor, not the
    // most-recently-clicked item.
  }

  function selectAll(visibleOrder: string[]): void {
    selected = new Set(visibleOrder);
    anchor = visibleOrder.length > 0 ? visibleOrder[0] : null;
  }

  function has(path: string): boolean {
    return selected.has(path);
  }

  function paths(): string[] {
    return [...selected];
  }

  function size(): number {
    return selected.size;
  }

  return {
    get selected(): ReadonlySet<string> { return selected; },
    get anchor(): string | null { return anchor; },
    get count(): number { return selected.size; },
    clear,
    setSingle,
    toggle,
    selectRange,
    selectAll,
    has,
    paths,
    size,
  };
}
