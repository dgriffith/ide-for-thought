/**
 * Multi-select for a type view's rows / cards (#2431). The sidebar's model
 * (`createPathSelection`) and semantics: ⌘/Ctrl-click toggles, ⇧-click extends
 * from the anchor in on-screen order, a plain click selects the row AND opens
 * it, ⌘A selects every row, Escape clears; right-click opens a one-item menu
 * ("Edit Properties…") for the selection. Pure UI state — the bulk write is the
 * host's (`onEdit`), routed through the bulk-property ops.
 *
 * From the keyboard (#2942, the WAI-ARIA multi-select conventions): Space
 * toggles the focused row, an arrow moves to the next row in the layout's
 * order, and ⇧ with it extends the selection from the anchor. Each change is
 * announced ("3 selected").
 */
import { createPathSelection } from '../stores/sidebar-selection.svelte';
import { announce } from '../stores/announcer.svelte';

export interface TypeViewSelectionOptions {
  /** Paths in the order the current layout shows them. */
  order: () => string[];
  /** False for an embed / export: clicks just open the note. */
  enabled: () => boolean;
  /**
   * An embed with note actions (#2774): no multi-select, but right-click opens
   * the menu for the one note under the pointer. Closing the menu lets go of it.
   */
  menuOnly?: () => boolean;
  onOpen: (path: string) => void;
  onEdit: (paths: string[]) => void;
}

export function createTypeViewSelection(opts: TypeViewSelectionOptions) {
  const selection = createPathSelection();
  /** `target`: the menu acts on that one note, not the selection — a note
   *  named inside a row (#2775). */
  let menu = $state<{ x: number; y: number; target?: string } | null>(null);
  /** The selection, restricted to rows still on screen (a filter may hide some). */
  const selectedPaths = $derived(opts.order().filter((p) => selection.has(p)));

  function click(e: MouseEvent, path: string): void {
    const on = opts.enabled();
    if (on && (e.metaKey || e.ctrlKey)) { selection.toggle(path); return; }
    if (on && e.shiftKey) { selection.selectRange(path, opts.order()); return; }
    if (on) selection.setSingle(path);
    opts.onOpen(path);
  }

  const menuOnly = () => !opts.enabled() && (opts.menuOnly?.() ?? false);

  function contextMenu(e: MouseEvent, path: string): void {
    if (!opts.enabled() && !menuOnly()) return;
    e.preventDefault();
    // A menu-only embed acts on exactly the note right-clicked.
    if (menuOnly() || !selection.has(path)) selection.setSingle(path);
    menu = { x: e.clientX, y: e.clientY };
  }

  /** Right-click a note named inside a row (#2775): the menu for THAT note.
   *  The rows' selection is left exactly as it was. */
  function contextMenuFor(e: MouseEvent, path: string): void {
    if (!opts.enabled() && !menuOnly()) return;
    e.preventDefault();
    e.stopPropagation(); // not the row's own menu as well
    menu = { x: e.clientX, y: e.clientY, target: path };
  }

  /**
   * The row menu for `paths`, at a point in the window — what a plugin drawing
   * the layout asks for (#2828), with the same rules as a right-click: none in
   * an embed without note actions, and one note at most in a menu-only embed.
   */
  function openMenuFor(paths: readonly string[], x: number, y: number): void {
    if ((!opts.enabled() && !menuOnly()) || paths.length === 0) return;
    if (menuOnly() || paths.length === 1) selection.setSingle(paths[0]!);
    else {
      selection.clear();
      for (const p of paths) selection.toggle(p);
    }
    menu = { x, y };
  }

  /** The menu for ONE note named inside a row, at a point — `contextMenuFor`
   *  from a plugin layout (#2828): the rows' selection is left as it was. */
  function openMenuForTarget(path: string, x: number, y: number): void {
    if (!opts.enabled() && !menuOnly()) return;
    menu = { x, y, target: path };
  }

  /** ⌘A and Escape from a plugin layout (#2828), with the keydown's rules. */
  /**
   * Several notes at once (#2939): a map's box. Adds each to the selection,
   * or with `toggle` (⌘ held) flips each in or out. Announced as a count.
   */
  function selectPaths(paths: readonly string[], toggle: boolean): void {
    if (!opts.enabled() || menuOnly() || paths.length === 0) return;
    for (const p of paths) if (toggle || !selection.has(p)) selection.toggle(p);
    say();
  }

  function selectAll(): void {
    if (opts.enabled() && !menuOnly()) selection.selectAll(opts.order());
  }
  function clear(): void {
    menu = null;
    selection.clear();
  }

  function closeMenu(): void {
    const wasTarget = !!menu?.target;
    menu = null;
    if (menuOnly() && !wasTarget) selection.clear();
  }

  function editSelected(): void {
    const paths = menu?.target ? [menu.target] : selectedPaths;
    closeMenu();
    if (paths.length > 0) opts.onEdit(paths);
  }

  const say = () => { const n = selectedPaths.length; announce(n === 0 ? 'Nothing selected' : `${n} selected`); };

  /**
   * A key on a focused row or card (#2942). `steps` maps an arrow to how far
   * it moves in the layout's order (a gallery's ↑ is a row of cards). Space
   * toggles the row; an arrow focuses the row it lands on, and with ⇧ extends
   * the selection from the anchor to it (from this row, when nothing is
   * selected). True when the key was taken.
   */
  function rowKey(e: KeyboardEvent, path: string, steps: Readonly<Record<string, number>>): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const on = opts.enabled() && !menuOnly();
    if (e.key === ' ' && !e.shiftKey) {
      if (!on) return false;
      e.preventDefault(); // not the button's click, which would open the note
      selection.toggle(path);
      say();
      return true;
    }
    const step = steps[e.key];
    const order = opts.order();
    const i = order.indexOf(path);
    if (step === undefined || i === -1) return false;
    e.preventDefault();
    const next = order[Math.max(0, Math.min(order.length - 1, i + step))]!;
    if (e.shiftKey && on) {
      if (selection.count === 0) selection.setSingle(path);
      selection.selectRange(next, order);
      say();
    }
    const scope = (e.currentTarget as HTMLElement | null)?.closest('.type-view');
    [...(scope?.querySelectorAll<HTMLElement>('[data-note-path]') ?? [])].find((el) => el.dataset['notePath'] === next)?.focus();
    return true;
  }

  function keydown(e: KeyboardEvent): void {
    if (menuOnly()) {
      if (e.key === 'Escape' && menu) closeMenu();
      return;
    }
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
    rowKey,
    contextMenu,
    contextMenuFor,
    openMenuFor,
    openMenuForTarget,
    selectAll,
    selectPaths,
    clear,
    keydown,
    editSelected,
    closeMenu,
  };
}
