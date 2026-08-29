<script lang="ts">
  /**
   * Versioning settings panel (#1158).
   *
   * The three knobs that decide how much disk local note history is allowed to
   * cost: how long a revision lives, how many pile up per note, and how big a
   * file is still worth snapshotting. Per-machine, like the compute settings —
   * what's being budgeted is this machine's disk.
   *
   * Self-contained: reads directly (reads are allowed in components) and routes
   * every write through the settings store per the renderer data-flow rule.
   * Saves per change; the store hands back what was actually stored, so a value
   * the main side clamped snaps back visibly rather than lying in the box.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getSettingsStore } from '../stores/settings.svelte';
  import type { HistorySettings } from '../../../shared/history';

  const settings = getSettingsStore();

  let current = $state<HistorySettings | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      current = await api.history.getSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  async function patch(delta: Partial<HistorySettings>): Promise<void> {
    if (!current) return;
    const next = { ...current, ...delta };
    try {
      current = await settings.setHistorySettings(next);
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  /** An emptied or non-numeric box shouldn't persist anything — leave the
   *  stored value alone until the user types something usable. Empty is checked
   *  explicitly because `Number('')` is 0, and 0 is a real setting here ("no
   *  size limit"), not a stand-in for "blank". */
  function onNumber(value: string, apply: (n: number) => void): void {
    if (value.trim() === '') return;
    const n = Number(value);
    if (Number.isFinite(n)) apply(n);
  }

  const sizeSummary = $derived(
    current === null
      ? ''
      : current.maxFileSizeKb === 0
        ? 'No limit — every note is snapshotted whatever its size.'
        : `Notes over ${current.maxFileSizeKb} KB are not snapshotted at all.`,
  );
</script>

{#if error}
  <p class="error">Couldn't load versioning settings: {error}</p>
{/if}

{#if current}
  <div class="field">
    <label for="retention-days">Keep versions for</label>
    <p class="hint">
      Days before an unnamed version is dropped. Named versions and each note's
      initial version are kept regardless.
    </p>
    <div class="number-row">
      <input
        id="retention-days"
        type="number"
        min="1"
        value={current.retentionDays}
        onchange={(e) => onNumber(e.currentTarget.value, (n) => patch({ retentionDays: n }))}
      />
      <span class="unit">days</span>
    </div>
  </div>

  <div class="field">
    <label for="max-revisions">Versions per note</label>
    <p class="hint">
      How many unnamed versions to keep for a single note, newest first. A long
      editing session can otherwise grow one note's history without bound.
    </p>
    <div class="number-row">
      <input
        id="max-revisions"
        type="number"
        min="1"
        value={current.maxRevisionsPerNote}
        onchange={(e) => onNumber(e.currentTarget.value, (n) => patch({ maxRevisionsPerNote: n }))}
      />
      <span class="unit">versions</span>
    </div>
  </div>

  <div class="field">
    <label for="max-file-size">Maximum file size</label>
    <p class="hint">
      Files bigger than this get no history — the guard against snapshotting a
      large generated <code>.csv</code> on every save. Set to <code>0</code> for
      no limit. {sizeSummary}
    </p>
    <div class="number-row">
      <input
        id="max-file-size"
        type="number"
        min="0"
        value={current.maxFileSizeKb}
        onchange={(e) => onNumber(e.currentTarget.value, (n) => patch({ maxFileSizeKb: n }))}
      />
      <span class="unit">KB</span>
    </div>
  </div>

  <p class="hint footnote">
    Stored per-machine — every thoughtbase on this machine shares these limits.
    Lowering one re-prunes the open thoughtbase immediately; others catch up the
    next time each note is saved.
  </p>
{/if}

<style>
  /* Shared form vocabulary, scoped to this panel (the app's per-dialog
     convention — each component carries its own .hint CSS). The base
     .field shape moved to global.css (#1910); this panel's fields also
     want extra bottom spacing, kept as a local override. */
  .field {
    margin-bottom: 18px;
  }
  .field label { color: var(--text); }
  .number-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .field input[type="number"] {
    width: 8em;
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .field input[type="number"]:focus {
    outline: none;
    border-color: var(--accent);
  }
  .unit { color: var(--text-muted); font-size: 11px; }
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint code {
    background: var(--bg-button);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
  .footnote { margin-top: 4px; }
  .error { color: var(--text); font-size: 12px; }
</style>
