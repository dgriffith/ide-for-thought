/**
 * Modal busy-overlay label (#670). When `label` is non-null, App renders a
 * full-window spinner overlay under that text. Promoted out of App.svelte so
 * the note-ops module (and future callers) can drive the overlay without a
 * prop fan-out.
 *
 * Going busy also announces the label (#2374): the overlay is rendered only
 * while busy, so as its own live region it would be inserted pre-filled and
 * skipped. Only the idle → busy transition speaks — a caller that updates the
 * label with a running count (maintenance progress) must not be read out per
 * tick.
 */
import { announce } from './announcer.svelte';

let label = $state<string | null>(null);

export function getBusyStore() {
  function setLabel(v: string | null) {
    if (v && !label) announce(v);
    label = v;
  }
  /**
   * Runs `fn` with the spinner overlay shown under `label`. Always clears
   * the overlay before returning — even on error — so that subsequent UI
   * (e.g. an error dialog) isn't trapped behind it.
   */
  async function withBusy<T>(l: string, fn: () => Promise<T>): Promise<T> {
    setLabel(l);
    try { return await fn(); } finally { label = null; }
  }
  return { get label() { return label; }, setLabel, withBusy };
}
