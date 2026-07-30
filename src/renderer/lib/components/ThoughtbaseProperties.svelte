<script lang="ts">
  /**
   * Thoughtbase Properties dialog (#1443). Rename (safe, instant) plus an
   * Advanced breakout to set the knowledge-graph base IRI — which rewrites every
   * graph identifier via a full re-index, so it's tucked away, warned, and
   * disabled while the review queue is non-empty (pending proposals hold
   * absolute IRIs that a rebuild can't re-derive). Reads its values directly
   * (reads are allowed in components); mutations route through the notebase
   * store via the `onSave` callback.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';

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
  let pendingCount = $state(0);
  let nameInput = $state<HTMLInputElement>();

  let saving = $state(false);
  let error = $state<string | null>(null);

  const baseLocked = $derived(pendingCount > 0);

  onMount(async () => {
    try {
      const p = await api.notebase.getProperties();
      name = p.displayName;
      folderName = p.folderName;
      baseUri = p.baseUri;
      initialBaseUri = p.baseUri;
      pendingCount = p.pendingProposalCount;
    } catch (e) {
      console.warn('[thoughtbase] failed to load properties:', e);
    }
    nameInput?.select();
  });

  async function save() {
    if (saving) return;
    saving = true;
    error = null;
    const baseChanged = !baseLocked && baseUri.trim() !== initialBaseUri;
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
    // Enter saves only from the name field — the base-IRI field is multiline-ish
    // intent (paste a long URL), so don't hijack Enter there.
    else if (e.key === 'Enter' && (e.target as HTMLElement)?.id === 'tb-props-name') void save();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tb-props-title">
    <header class="card-header">
      <div class="eyebrow">Thoughtbase</div>
      <h2 class="title" id="tb-props-title">Properties</h2>
    </header>

    <div class="body">
      <label class="field-label" for="tb-props-name">Name</label>
      <input
        id="tb-props-name"
        bind:this={nameInput}
        bind:value={name}
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
            disabled={baseLocked}
          />
          {#if baseLocked}
            <p class="hint warn">
              Locked while {pendingCount} proposal{pendingCount === 1 ? '' : 's'} await review — they
              reference notes by absolute IRI and can't survive a rebase. Clear the review queue first.
            </p>
          {:else}
            <p class="hint warn">
              Rewrites every knowledge-graph identifier (a full re-index runs on save).
              Existing exports and any hand-pasted IRIs that used the old base will no
              longer resolve. Wiki-links are unaffected.
            </p>
          {/if}
        </div>
      </details>

      {#if error}
        <p class="error-msg">✗ {error}</p>
      {/if}
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↵ save</span>
      <span class="footer-actions">
        <button class="btn secondary" onclick={onCancel}>Cancel</button>
        <button class="btn primary" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}<span class="btn-kbd">↵</span></button>
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 460px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }
  .card-header { padding: 20px 24px 0; }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -0.005em;
    line-height: 1.3;
  }
  .body { padding: 14px 24px 18px; }
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
  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint {
    margin-right: auto;
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .footer-actions { display: inline-flex; gap: 8px; }
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
