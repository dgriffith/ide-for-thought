/**
 * Minimal toast store (#1541).
 *
 * A tiny, dismissable, auto-expiring notification queue — deliberately NOT a
 * toast library. Built for the proposal-arrival cue (a glance-and-ignore nudge,
 * per CLAUDE.md's "stay out of the way"), but generic enough to reuse. Surfaces
 * that need a transient message call `push`; the `Toasts.svelte` corner
 * container renders the list.
 */
export interface Toast {
  id: number;
  message: string;
  /** Optional click action (e.g. open the Proposals panel). */
  onClick?: () => void;
}

let items = $state<Toast[]>([]);
// Monotonic id — module counter (no Date.now/random needed for uniqueness).
let nextId = 1;

export function getToastStore() {
  function dismiss(id: number): void {
    items = items.filter((t) => t.id !== id);
  }

  /**
   * Show a toast; it auto-dismisses after `durationMs` (default 6s). Returns the
   * id so a caller can dismiss early.
   */
  function push(toast: { message: string; onClick?: () => void; durationMs?: number }): number {
    const id = nextId++;
    const item: Toast = toast.onClick
      ? { id, message: toast.message, onClick: toast.onClick }
      : { id, message: toast.message };
    items = [...items, item];
    const ms = toast.durationMs ?? 6000;
    if (ms > 0) setTimeout(() => dismiss(id), ms);
    return id;
  }

  return {
    get items(): Toast[] {
      return items;
    },
    push,
    dismiss,
  };
}
