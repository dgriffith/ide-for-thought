<script lang="ts">
  /**
   * Thoughtbase Properties dialog (#1443) — Part A: rename. The display name is
   * decoupled from the folder (stored in .minerva/config.json); clearing it
   * falls back to the folder basename. Base-IRI editing is the advanced tier,
   * added in Part B. Reads its current values directly (reads are allowed in
   * components); the save routes through the notebase store (mutation).
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';

  interface Props {
    /** Persist the trimmed name ('' clears → folder basename). */
    onSave: (name: string) => void;
    onCancel: () => void;
  }
  let { onSave, onCancel }: Props = $props();

  let name = $state('');
  let folderName = $state('');
  let inputEl = $state<HTMLInputElement>();

  onMount(async () => {
    try {
      const p = await api.notebase.getProperties();
      name = p.displayName;
      folderName = p.folderName;
    } catch (e) {
      console.warn('[thoughtbase] failed to load properties:', e);
    }
    inputEl?.select();
  });

  function save() { onSave(name.trim()); }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') save();
    else if (e.key === 'Escape') onCancel();
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
        bind:this={inputEl}
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
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↵ save</span>
      <span class="footer-actions">
        <button class="btn secondary" onclick={onCancel}>Cancel</button>
        <button class="btn primary" onclick={save}>Save<span class="btn-kbd">↵</span></button>
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
  .hint {
    margin: 8px 0 0;
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1.45;
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
  .primary:hover { opacity: 0.92; }
  .btn-kbd { font-family: var(--font-mono); font-size: 10px; opacity: 0.7; }
</style>
