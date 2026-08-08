<script lang="ts">
  /**
   * Add-Property dialog — collects a frontmatter property's name, type, AND
   * value on one panel (vs. two sequential prompts). Mirrors PromptDialog's
   * chrome; the name field autocompletes from the thoughtbase's
   * frontmatter-key vocabulary, and the value uses the same type-aware editor
   * the Properties panel does, so a real boolean / number / date is written
   * rather than a stringified one.
   */
  import type { AddPropertyResult } from '../stores/dialogs.svelte';
  import PropertyValueEditor from './PropertyValueEditor.svelte';
  import {
    SCALAR_TYPES,
    coerceScalar,
    isValidScalar,
    type ScalarType,
  } from '../../../shared/refactor/property-shape';

  interface Props {
    message: string;
    keySuggestions: string[];
    onConfirm: (value: AddPropertyResult) => void;
    onCancel: () => void;
  }

  let { message, keySuggestions, onConfirm, onCancel }: Props = $props();

  let name = $state('');
  let type = $state<ScalarType>('string');
  /** Raw text for string/number/date; the boolean uses `boolValue`. */
  let text = $state('');
  let boolValue = $state(false);
  let nameEl = $state<HTMLInputElement>();
  const listId = `add-property-keys-${Math.random().toString(36).slice(2, 9)}`;

  const canConfirm = $derived(
    name.trim().length > 0 && (type === 'boolean' || isValidScalar(type, text)),
  );
  function submit() {
    if (!canConfirm) return;
    const value = type === 'boolean' ? boolValue : coerceScalar(type, text);
    onConfirm({ name: name.trim(), value });
  }

  function onOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }
  function onNameKeydown(e: KeyboardEvent) {
    // Enter on the name field submits directly — the value has a sensible
    // default per type (empty string / 0 / false / today-less date), so a
    // reflexive Enter after typing a key still does something useful.
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  }

  $effect(() => { nameEl?.focus(); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={onOverlayKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="add-property-title">
    <header class="card-header">
      <div class="eyebrow">Property</div>
      <h2 class="title" id="add-property-title">{message}</h2>
    </header>

    <div class="body">
      <label class="field">
        <span class="field-label">Name</span>
        <input
          bind:this={nameEl}
          bind:value={name}
          onkeydown={onNameKeydown}
          type="text"
          class="input"
          list={keySuggestions.length > 0 ? listId : undefined}
          autocomplete="off"
          placeholder="e.g. status"
        />
        {#if keySuggestions.length > 0}
          <datalist id={listId}>
            {#each keySuggestions as s}
              <option value={s}></option>
            {/each}
          </datalist>
        {/if}
      </label>
      <div class="field-row">
        <label class="field type-field">
          <span class="field-label">Type</span>
          <select class="input select" bind:value={type}>
            {#each SCALAR_TYPES as t}
              <option value={t}>{t}</option>
            {/each}
          </select>
        </label>
        <div class="field value-field">
          <span class="field-label">Value</span>
          <div class="value-slot">
            <PropertyValueEditor
              {type}
              {text}
              checked={boolValue}
              onInput={(raw) => { text = raw; }}
              onCommit={(raw) => { text = raw; }}
              onToggle={(c) => { boolValue = c; }}
            />
          </div>
        </div>
      </div>
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↵ next / confirm</span>
      <span class="footer-actions">
        <button class="btn secondary" onclick={onCancel}>Cancel</button>
        <button class="btn primary" disabled={!canConfirm} onclick={submit}>
          Add
          <span class="btn-kbd">↵</span>
        </button>
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-spawned);
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
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 460px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }

  .card-header {
    padding: 20px 24px 0;
  }
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
    color: var(--text);
  }

  .body {
    padding: 14px 24px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .field-label {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
  }
  .input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .field-row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .type-field {
    flex: 0 0 120px;
  }
  .value-field {
    flex: 1 1 auto;
    min-width: 0;
  }
  .select {
    appearance: auto;
    cursor: pointer;
  }
  /* Match the taller .input chrome so the editor lines up with the select. */
  .value-slot :global(.pve-input) {
    padding: 8px 10px;
    border-radius: 6px;
    border-color: var(--border-strong);
    font-size: 14px;
  }
  .value-slot {
    display: flex;
    align-items: center;
    min-height: 37px;
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
  .footer-actions {
    display: inline-flex;
    gap: 8px;
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
  .secondary {
    background: transparent;
    color: var(--text-muted);
  }
  .secondary:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    opacity: 0.92;
  }
  .primary:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn-kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.7;
  }
</style>
