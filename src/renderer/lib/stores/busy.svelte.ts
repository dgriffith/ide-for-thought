/**
 * Modal busy-overlay label (#670). When `label` is non-null, App renders a
 * full-window spinner overlay under that text. Promoted out of App.svelte so
 * the note-ops module (and future callers) can drive the overlay without a
 * prop fan-out.
 */
let label = $state<string | null>(null);

export function getBusyStore() {
  function setLabel(v: string | null) { label = v; }
  /**
   * Runs `fn` with the spinner overlay shown under `label`. Always clears
   * the overlay before returning — even on error — so that subsequent UI
   * (e.g. an error dialog) isn't trapped behind it.
   */
  async function withBusy<T>(l: string, fn: () => Promise<T>): Promise<T> {
    label = l;
    try { return await fn(); } finally { label = null; }
  }
  return { get label() { return label; }, setLabel, withBusy };
}
