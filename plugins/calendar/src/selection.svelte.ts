/**
 * The calendar's selection (#2938): the view's own, which Minerva holds, as
 * for a board (#2828) and a timeline (#2937). A click carries its modifiers
 * (⌘ toggles, ⇧ extends in time order — Minerva's range runs in the
 * calendar's order, #2942); a plain click opens the note. Space toggles the
 * focused event and ⇧ with an arrow extends to the next one, both as
 * `view.click`'s own modifiers. Never in an embed or export.
 *
 * `Calendar.svelte` makes one and provides it as context, so the grid, the
 * day list, the week, the agenda, the bands and Undated all read the same
 * selection without a prop each.
 */
import { getContext, setContext } from 'svelte';
import type { MinervaPlugin, PluginViewState } from '/@minerva/plugin-api.js';

export interface CalendarSelection {
  /** The view selects: a type's own tab, not an embed or export. */
  readonly selectable: boolean;
  /** Selected notes, as Minerva sent them. */
  readonly paths: readonly string[];
  has(key: string): boolean;
  /** A click on an event: with its modifiers where the view selects; a plain one, or any in an embed, opens it. */
  click(key: string, e?: MouseEvent): void;
  /**
   * Space toggles `key`; ⇧ with one of `keys` (back, forward) extends to the
   * neighbour in `along` and hands it to `focus` — from `key` when nothing is
   * selected. True when the key was taken.
   */
  key(e: KeyboardEvent, key: string, along: readonly string[], keys: readonly [string, string], focus: (key: string) => void): boolean;
  selectAll(): void;
  clear(): void;
}

const KEY = Symbol('calendar-selection');

export function createCalendarSelection(minerva: MinervaPlugin, view: () => PluginViewState): CalendarSelection {
  const quietly = (p: Promise<unknown>) => { p.catch(() => {}); };
  const selectable = $derived(view().selectable && !view().exportMode);
  const selected = $derived(new Set(view().selected));

  // A change from the keyboard is said once Minerva's view of it has settled:
  // a ⇧+arrow can be two clicks, and each can send a view.
  let say = false;
  let sayTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const n = view().selected.length;
    if (!say) return;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { say = false; quietly(minerva.ui.announce({ text: n === 0 ? 'Nothing selected' : `${n} selected` })); }, 120);
  });

  return {
    get selectable() { return selectable; },
    get paths() { return view().selected; },
    has: (key) => selected.has(key),
    click(key, e) {
      if (!selectable || !e) { quietly(minerva.view.click({ path: key })); return; }
      quietly(minerva.view.click({ path: key, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey }));
    },
    key(e, key, along, keys, focus) {
      if (!selectable || e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key === ' ' && !e.shiftKey) {
        e.preventDefault(); // not the button's click, which would open the note
        say = true;
        quietly(minerva.view.click({ path: key, meta: true }));
        return true;
      }
      if (!e.shiftKey || !keys.includes(e.key)) return false;
      e.preventDefault();
      const i = along.indexOf(key);
      const next = along[i + (e.key === keys[0] ? -1 : 1)];
      if (i === -1 || next === undefined) return true;
      say = true;
      if (view().selected.length === 0) quietly(minerva.view.click({ path: key, meta: true }));
      quietly(minerva.view.click({ path: next, shift: true }));
      focus(next);
      return true;
    },
    selectAll() { if (selectable) quietly(minerva.view.selectAll()); },
    clear() { if (selectable) quietly(minerva.view.clearSelection()); },
  };
}

export function provideSelection(sel: CalendarSelection): void {
  setContext(KEY, sel);
}

/** The calendar's selection, or one that selects nothing (a component drawn on its own, as in a test). */
export function useSelection(): CalendarSelection {
  return getContext<CalendarSelection | undefined>(KEY) ?? {
    selectable: false, paths: [], has: () => false, click: () => {}, key: () => false, selectAll: () => {}, clear: () => {},
  };
}
