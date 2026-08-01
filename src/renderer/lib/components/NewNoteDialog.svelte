<script lang="ts">
  /**
   * Two-column New Note dialog (#475 will fill in the template list).
   *
   * Left column: note-type picker (Note · Graph · Table · Script).
   * Right column: name field, with a labeled "Template" slot that's
   * intentionally reserved for the upcoming templates feature so the
   * eventual addition doesn't re-lay-out the modal.
   *
   * Returns `{ name, ext }` via the host's resolver. The host appends
   * the extension if the user didn't type one already.
   */
  import Icon from './Icon.svelte';
  import type { IconName } from './icons/registry';
  import { api, type TemplateInfo } from '../ipc/client';
  import type { TypeInfo } from '../../../shared/objects/type-def';
  import type { NoteExt, NewNoteResult } from './new-note-dialog-types';

  interface TypeOption {
    ext: NoteExt;
    label: string;
    description: string;
    icon: IconName;
  }

  const TYPES: ReadonlyArray<TypeOption> = [
    { ext: '.md',  label: 'Note',   description: 'Markdown',          icon: 'notes' },
    { ext: '.ttl', label: 'Graph',  description: 'Turtle / RDF',      icon: 'graph' },
    { ext: '.csv', label: 'Table',  description: 'Comma-separated',   icon: 'tables' },
    { ext: '.py',  label: 'Script', description: 'Python',            icon: 'code' },
  ];

  interface Props {
    onConfirm: (result: NewNoteResult) => void;
    onCancel: () => void;
    /** Default selected type — usually `.md` but a caller could seed
     *  a different default if invoked from a type-aware surface. */
    initialExt?: NoteExt;
  }

  let { onConfirm, onCancel, initialExt = '.md' }: Props = $props();

  // Intentional one-time seed from `initialExt`; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
  let ext = $state<NoteExt>(initialExt);
  let name = $state('');
  let inputEl = $state<HTMLInputElement>();
  let templates = $state<TemplateInfo[]>([]);
  /** `null` = blank file. Empty string from the select element maps
   *  to null on read; the select stores filenames. */
  let templateFilename = $state<string | null>(null);
  /** Domain types from the live registry (#1064). Creating a note *as* a type
   *  seeds its template + property scaffold. */
  let types = $state<TypeInfo[]>([]);
  let selectedType = $state<TypeInfo | null>(null);

  $effect(() => { inputEl?.focus(); });

  // Load templates + types once on mount; both lists are small.
  $effect(() => {
    void api.templates.list().then((list) => { templates = list; });
    void api.types.list().then((cat) => { types = cat.types; });
  });

  /** Pick a plain file kind — clears any domain type. */
  function pickExt(next: NoteExt) {
    ext = next;
    selectedType = null;
    inputEl?.focus();
  }
  /** Create *as* a domain type — always a markdown note (#1064). */
  function pickType(t: TypeInfo) {
    selectedType = t;
    ext = '.md';
    inputEl?.focus();
  }

  /** Templates only make sense for a plain markdown note — a domain type brings
   *  its own template, and other file kinds don't take one. */
  const templatesApply = $derived(ext === '.md' && !selectedType);

  /** Strip the chosen type's extension from the typed name if the
   *  user typed it explicitly — keeps the on-disk filename clean
   *  whether they typed "draft" or "draft.py". */
  function normalize(): NewNoteResult | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    const stripped = lower.endsWith(ext)
      ? trimmed.slice(0, -ext.length)
      : trimmed;
    return {
      name: stripped,
      ext,
      templateFilename: templatesApply ? templateFilename : null,
      type: selectedType,
    };
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const norm = normalize();
      if (norm) onConfirm(norm);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true">
    <header class="card-header">
      <div class="eyebrow">New</div>
      <h2 class="title">{selectedType ? `New ${selectedType.label}` : 'New Note'}</h2>
    </header>

    <div class="body">
      <!-- Left: type picker. Vertical list so future additions don't
           pinch the horizontal layout. -->
      <div class="type-list" role="radiogroup" aria-label="Note type">
        {#each TYPES as t (t.ext)}
          {@const active = ext === t.ext && !selectedType}
          <button
            type="button"
            class="type-row"
            class:active
            role="radio"
            aria-checked={active}
            onclick={() => pickExt(t.ext)}
          >
            <Icon name={t.icon} size={14} color={active ? 'var(--accent)' : 'currentColor'} />
            <span class="type-text">
              <span class="type-label">{t.label}</span>
              <span class="type-desc">{t.description}</span>
            </span>
            <span class="type-ext">{t.ext}</span>
          </button>
        {/each}

        <!-- Domain types (#1064): "New Book" is a menu choice, not a syntax. -->
        {#if types.length > 0}
          <div class="type-divider">Types</div>
          {#each types as t (t.id)}
            {@const active = selectedType?.id === t.id}
            <button
              type="button"
              class="type-row"
              class:active
              role="radio"
              aria-checked={active}
              onclick={() => pickType(t)}
              title={t.source === 'user' ? 'Your type' : 'Built-in type'}
            >
              <span class="type-emoji" style={t.color ? `color:${t.color}` : undefined}>{t.icon ?? '◆'}</span>
              <span class="type-text">
                <span class="type-label">{t.label}</span>
                <span class="type-desc">{t.properties.length} field{t.properties.length === 1 ? '' : 's'}</span>
              </span>
            </button>
          {/each}
        {/if}
      </div>

      <!-- Right: name + reserved Template slot. -->
      <div class="form">
        <label class="field">
          <span class="field-label">Name</span>
          <input
            bind:this={inputEl}
            bind:value={name}
            type="text"
            class="input"
            autocomplete="off"
            placeholder="My note"
          />
        </label>

        {#if templatesApply}
          <div class="template-slot">
            <span class="field-label">Template</span>
            <div class="template-list" role="radiogroup" aria-label="Template">
              <button
                type="button"
                class="template-row"
                class:active={templateFilename === null}
                role="radio"
                aria-checked={templateFilename === null}
                onclick={() => { templateFilename = null; inputEl?.focus(); }}
              >
                <span class="template-name">(none)</span>
                <span class="template-hint">blank file</span>
              </button>
              {#each templates as t (t.filename)}
                {@const active = templateFilename === t.filename}
                <button
                  type="button"
                  class="template-row"
                  class:active
                  role="radio"
                  aria-checked={active}
                  onclick={() => { templateFilename = t.filename; inputEl?.focus(); }}
                >
                  <span class="template-name">{t.name}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ↵ create</span>
      <span class="footer-actions">
        <button class="btn secondary" onclick={onCancel}>Cancel</button>
        <button
          class="btn primary"
          disabled={!name.trim()}
          onclick={() => { const n = normalize(); if (n) onConfirm(n); }}
        >
          Create
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
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 560px;
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
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 16px;
    padding: 16px 24px 18px;
  }

  /* ── Type list (left column) ───────────────────────────────────── */
  .type-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    background: var(--bg-inset);
  }
  .type-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .type-row:hover:not(.active) {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    color: var(--text);
  }
  .type-row.active {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .type-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .type-label {
    font-size: 12.5px;
    font-weight: 500;
  }
  .type-desc {
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .type-row.active .type-desc { color: var(--accent); opacity: 0.7; }
  .type-ext {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .type-row.active .type-ext { color: var(--accent); opacity: 0.8; }
  .type-divider {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
    padding: 8px 9px 3px;
  }
  .type-emoji {
    width: 14px;
    font-size: 13px;
    line-height: 1;
    text-align: center;
    flex-shrink: 0;
  }

  /* ── Form (right column) ───────────────────────────────────────── */
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .field-label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    letter-spacing: 0.06em;
    text-transform: uppercase;
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
    box-sizing: border-box;
  }

  /* Template picker (#475). Only rendered for .md, since substitution
     produces markdown content. (none) row keeps the blank-file path
     as the default. */
  .template-slot {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .template-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
    background: var(--bg-inset);
    max-height: 168px;
    overflow-y: auto;
  }
  .template-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .template-row:hover:not(.active) {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    color: var(--text);
  }
  .template-row.active {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .template-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .template-hint {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    flex-shrink: 0;
  }
  .template-row.active .template-hint { color: var(--accent); opacity: 0.7; }

  /* ── Footer ────────────────────────────────────────────────────── */
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
  .primary:hover:not(:disabled) { opacity: 0.92; }
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
