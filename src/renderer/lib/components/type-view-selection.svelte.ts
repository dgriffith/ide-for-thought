/**
 * Multi-select for a type view's rows / cards (#2431). The sidebar's model
 * (`createPathSelection`) and semantics: ⌘/Ctrl-click toggles, ⇧-click extends
 * from the anchor in on-screen order, a plain click selects the row AND opens
 * it, ⌘A selects every row, Escape clears; right-click opens a one-item menu
 * ("Edit Properties…") for the selection. Pure UI state — the bulk write is the
 * host's (`onEdit`), routed through the bulk-property ops.
 */
import { createPathSelection } from '../stores/sidebar-selection.svelte';

export interface TypeViewSelectionOptions {
  /** Paths in the order the current layout shows them. */
  order: () => string[];
  /** False for an embed / export: clicks just open the note. */
  enabled: () => boolean;
  onOpen: (path: string) => void;
  onEdit: (paths: string[]) => void;
}

export function createTypeViewSelection(opts: TypeViewSelectionOptions) {
  const selection = createPathSelection();
  let menu = $state<{ x: number; y: number } | null>(null);
  /** The selection, restricted to rows still on screen (a filter may hide some). */
  const selectedPaths = $derived(opts.order().filter((p) => selection.has(p)));

  function click(e: MouseEvent, path: string): void {
    const on = opts.enabled();
    if (on && (e.metaKey || e.ctrlKey)) { selection.toggle(path); return; }
    if (on && e.shiftKey) { selection.selectRange(path, opts.order()); return; }
    if (on) selection.setSingle(path);
    opts.onOpen(path);
  }

  function contextMenu(e: MouseEvent, path: string): void {
    if (!opts.enabled()) return;
    e.preventDefault();
    if (!selection.has(path)) selection.setSingle(path);
    menu = { x: e.clientX, y: e.clientY };
  }

  function editSelected(): void {
    menu = null;
    if (selectedPaths.length > 0) opts.onEdit(selectedPaths);
  }

  function keydown(e: KeyboardEvent): void {
    if (!opts.enabled()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selection.selectAll(opts.order());
    } else if (e.key === 'Escape' && (selection.count > 0 || menu)) {
      menu = null;
      selection.clear();
    }
  }

  return {
    get menu() { return menu; },
    get selectedPaths() { return selectedPaths; },
    has: (path: string) => selection.has(path),
    click,
    contextMenu,
    keydown,
    editSelected,
    closeMenu: () => { menu = null; },
  };
}
