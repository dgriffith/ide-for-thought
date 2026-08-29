<script lang="ts">
  /**
   * Thoughtbase Properties dialog (#1443). Rename (safe, instant) plus an
   * Advanced breakout to set the knowledge-graph base IRI — which rewrites every
   * graph identifier via a full re-index, so it's tucked away and warned about.
   *
   * It is NOT gated on an empty review queue: that was the original design (a
   * pending proposal holds absolute IRIs a rebuild can't re-derive), but
   * `indexAllNotes`' `rebaseFrom` now rewrites proposal IRIs old→new during the
   * rebuild, so the guard was dropped. `checkRebase` is the only refusal left —
   * an absolute http(s) URL ending in '/'.
   *
   * Reads its values directly (reads are allowed in components); mutations
   * route through the notebase store via the `onSave` callback.
   *
   * Renders via ui/Dialog.svelte (#1888) — Escape-to-cancel and backdrop-click
   * are Dialog's job. Enter-to-save moves onto the name field directly (it was
   * already narrowed there via an `e.target.id` check) — the base-IRI field is
   * multiline-ish intent (paste a long URL), so it must NOT take Enter.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import Dialog from './ui/Dialog.svelte';
  import { logger } from '../../../shared/logger';

  interface Props {
    /** Persist name + (when changed) base IRI. Resolves to the outcome so a
     *  validation error / review-queue refusal shows inline; the parent closes
     *  the dialog on success. `baseUri` is omitted when unchanged. */
    onSave: (p: { name: string; baseUri?: string }) => Promise<{ ok: boolean; error?: string }>;
    onCancel: () => void;
  }
  let { onSave, onCancel }: Props = $props();

  let name = $state('');
  let folderName = $state('');
  let baseUri = $state('');
  let initialBaseUri = $state('');
  let nameInput = $state<HTMLInputElement>();

  let saving = $state(false);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const p = await api.notebase.getProperties();
      name = p.displayName;
      folderName = p.folderName;
      baseUri = p.baseUri;
      initialBaseUri = p.baseUri;
    } catch (e) {
      logger('thoughtbase').warn('failed to load properties:', e);
    }
    nameInput?.select();
  });

  async function save() {
    if (saving) return;
    saving = true;
    error = null;
    const baseChanged = baseUri.trim() !== initialBaseUri;
    try {
      const r = await onSave({ name: name.trim(), ...(baseChanged ? { baseUri: baseUri.trim() } : {}) });
      if (!r.ok) error = r.error ?? 'Could not save.';
      // On success the parent unmounts this dialog.
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') void save();
  }
</script>

<Dialog width={460} onClose={onCancel} titleId="tb-props-title">
  {#snippet eyebrow()}Thoughtbase{/snippet}
  {#snippet title()}Properties{/snippet}
  {#snippet body()}
    <label class="field-label" for="tb-props-name">Name</label>
    <input
      id="tb-props-name"
      bind:this={nameInput}
      bind:value={name}
      onkeydown={handleNameKeydown}
      type="text"
      class="input"
      placeholder={folderName}
      autocomplete="off"
      spellcheck="false"
    />
    <p class="hint">
      A display label, independent of the folder on disk. Leave blank to use
      the folder name{folderName ? ` (${folderName})` : ''}.
    </p>

    <details class="advanced">
      <summary>Advanced</summary>
      <div class="advanced-body">
        <label class="field-label" for="tb-props-base">Graph base IRI</label>
        <input
          id="tb-props-base"
          bind:value={baseUri}
          type="text"
          class="input"
          autocomplete="off"
          spellcheck="false"
        />
        <p class="hint warn">
          Rewrites every knowledge-graph identifier (a full re-index runs on save).
          Pending and reviewed proposals are migrated to the new base automatically;
          wiki-links are unaffected. Existing exports and any hand-pasted IRIs that
          used the old base will no longer resolve.
        </p>
      </div>
    </details>

    {#if error}
      <p class="error-msg">✗ {error}</p>
    {/if}
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel · ↵ save</span>{/snippet}
  {#snippet footerRight()}
    <button class="btn secondary" onclick={onCancel}>Cancel</button>
    <button class="btn primary" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}<span class="btn-kbd">↵</span></button>
  {/snippet}
</Dialog>

<style>
  .field-label {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 5px;
  }
  .input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .input:disabled { opacity: 0.55; box-shadow: none; border-color: var(--border); }
  .hint {
    margin: 8px 0 0;
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1.45;
  }
  .hint.warn { color: var(--text-muted); }
  .advanced {
    margin-top: 16px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .advanced summary {
    cursor: pointer;
    font-size: 11.5px;
    color: var(--text-muted);
    user-select: none;
  }
  .advanced summary:hover { color: var(--text); }
  .advanced-body { padding-top: 12px; }
  .error-msg {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--rust, #c66);
  }
  .kbd-hint {
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .secondary { background: transparent; color: var(--text-muted); }
  .secondary:hover { color: var(--text); border-color: var(--border-strong); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
  .primary:hover:not(:disabled) { opacity: 0.92; }
  .primary:disabled { opacity: 0.5; cursor: default; }
  .btn-kbd { font-family: var(--font-mono); font-size: 10px; opacity: 0.7; }
</style>
