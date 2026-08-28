<script lang="ts">
  /**
   * Create / edit a smart collection backed by a tag predicate (#470 phase 2).
   *
   * v1 supports the `tags allOf` predicate only — the user picks N tags
   * and a source is a member when it carries every one. The dialog
   * surfaces project tag vocabulary via `api.tags.list()` so the user
   * doesn't have to remember spellings.
   *
   * Future predicate kinds (faceted, raw SPARQL) will extend this
   * dialog with a kind-picker; for now the kind is hardcoded.
   */
  import { api } from '../ipc/client';
  import type { SmartCollection, SmartCollectionPredicate, TagInfo, ReadStatus } from '../../../shared/types';
  import Icon from './Icon.svelte';
  import Eyebrow from './ui/Eyebrow.svelte';

  const READ_STATUS_OPTIONS: { value: ReadStatus; label: string }[] = [
    { value: 'unread', label: 'Unread' },
    { value: 'reading', label: 'Reading' },
    { value: 'read', label: 'Read' },
    { value: 'skipped', label: 'Skipped' },
  ];

  type PredicateKind = SmartCollectionPredicate['kind'];

  interface Props {
    /** When provided, the dialog opens in edit mode pre-filled with
     *  this collection's name + predicate. Omit for the create flow. */
    editing?: SmartCollection;
    onSave: (name: string, predicate: SmartCollectionPredicate) => Promise<void>;
    onCancel: () => void;
  }

  let { editing, onSave, onCancel }: Props = $props();

  const mode = $derived<'create' | 'edit'>(editing ? 'edit' : 'create');
  // Intentional one-time seed from `editing`; dialog is short-lived and keyed.
  // svelte-ignore state_referenced_locally
  let name = $state(editing?.name ?? '');
  // svelte-ignore state_referenced_locally
  let kind = $state<PredicateKind>(editing?.predicate.kind ?? 'tags');
  /** Picked tags (allOf), preserved as a Set for O(1) lookup in the
   *  template. Initialised from the editing predicate when present. */
  // svelte-ignore state_referenced_locally
  let selectedTags = $state<Set<string>>(new Set(
    editing && editing.predicate.kind === 'tags' ? editing.predicate.allOf : [],
  ));
  // svelte-ignore state_referenced_locally
  let selectedStatuses = $state<Set<ReadStatus>>(new Set(
    editing && editing.predicate.kind === 'readStatus' ? editing.predicate.status : [],
  ));
  let tagFilter = $state('');
  let saving = $state(false);
  let allTags = $state<TagInfo[]>([]);
  let nameInputEl = $state<HTMLInputElement>();

  $effect(() => { void loadTags(); });
  $effect(() => { nameInputEl?.focus(); });

  async function loadTags(): Promise<void> {
    // Smart collections here filter *sources*, so only offer tags that appear
    // on at least one source (`sourceCount > 0`). The unfiltered vocabulary
    // includes note-only tags, which can never match a source predicate.
    allTags = (await api.tags.list()).filter((t) => t.sourceCount > 0);
    // Restore any pre-selected tag that doesn't appear in the live
    // source vocabulary (e.g. the predicate references a tag that's
    // since been removed from every source). We still show it so the
    // user can either keep it or uncheck it deliberately.
    for (const t of selectedTags) {
      if (!allTags.some((info) => info.tag === t)) {
        allTags = [...allTags, { tag: t, noteCount: 0, sourceCount: 0 }];
      }
    }
  }

  const visibleTags = $derived.by(() => {
    const q = tagFilter.trim().toLowerCase();
    const list = q ? allTags.filter((t) => t.tag.toLowerCase().includes(q)) : allTags;
    // Pinned at top: anything currently selected, so the user can
    // see their picks even after filtering.
    return [...list].sort((a, b) => {
      const aPicked = selectedTags.has(a.tag) ? 0 : 1;
      const bPicked = selectedTags.has(b.tag) ? 0 : 1;
      if (aPicked !== bPicked) return aPicked - bPicked;
      return a.tag.localeCompare(b.tag);
    });
  });

  function toggleTag(tag: string) {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag); else next.add(tag);
    selectedTags = next;
  }

  function toggleStatus(status: ReadStatus) {
    const next = new Set(selectedStatuses);
    if (next.has(status)) next.delete(status); else next.add(status);
    selectedStatuses = next;
  }

  const canSave = $derived.by(() => {
    if (!name.trim() || saving) return false;
    if (kind === 'tags') return selectedTags.size > 0;
    if (kind === 'readStatus') return selectedStatuses.size > 0;
    return false;
  });

  function currentPredicate(): SmartCollectionPredicate {
    if (kind === 'readStatus') {
      return { kind: 'readStatus', status: [...selectedStatuses] };
    }
    return { kind: 'tags', allOf: [...selectedTags] };
  }

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    saving = true;
    try {
      await onSave(name.trim(), currentPredicate());
    } finally {
      saving = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSave();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={mode === 'create' ? 'New smart collection' : 'Edit smart collection'}>
    <header class="card-header">
      <div class="eyebrow-row"><Eyebrow>{mode === 'create' ? 'New smart collection' : 'Edit smart collection'}</Eyebrow></div>
      <input
        bind:this={nameInputEl}
        type="text"
        class="name-input"
        placeholder="Collection name"
        bind:value={name}
      />
    </header>

    <section class="body">
      <div class="kind-row">
        <label class="kind-radio">
          <input type="radio" name="predicate-kind" value="tags" checked={kind === 'tags'} onchange={() => { kind = 'tags'; }} />
          <span>Tag predicate</span>
        </label>
        <label class="kind-radio">
          <input type="radio" name="predicate-kind" value="readStatus" checked={kind === 'readStatus'} onchange={() => { kind = 'readStatus'; }} />
          <span>Reading status</span>
        </label>
      </div>

      {#if kind === 'tags'}
        <div class="rule-label">Sources tagged with <strong>all</strong> of:</div>
        <div class="tag-filter-row">
          <Icon name="search" size={12} color="var(--text-muted)" />
          <input
            type="text"
            class="tag-filter"
            placeholder="Filter tags…"
            bind:value={tagFilter}
          />
          <span class="picked-count">{selectedTags.size} picked</span>
        </div>
        <div class="tag-list">
          {#if visibleTags.length === 0}
            {#if allTags.length === 0}
              <div class="empty">No tags in project yet.</div>
            {:else}
              <div class="empty">No tags match "{tagFilter}".</div>
            {/if}
          {:else}
            {#each visibleTags as t (t.tag)}
              <label class="tag-row" class:checked={selectedTags.has(t.tag)}>
                <input
                  type="checkbox"
                  checked={selectedTags.has(t.tag)}
                  onchange={() => toggleTag(t.tag)}
                />
                <span class="tag-name">#{t.tag}</span>
                <span class="tag-count">{t.sourceCount}</span>
              </label>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="rule-label">Sources with <strong>any</strong> of these statuses:</div>
        <div class="status-list">
          {#each READ_STATUS_OPTIONS as opt (opt.value)}
            <label class="tag-row" class:checked={selectedStatuses.has(opt.value)}>
              <input
                type="checkbox"
                checked={selectedStatuses.has(opt.value)}
                onchange={() => toggleStatus(opt.value)}
              />
              <span class="tag-name">{opt.label}</span>
            </label>
          {/each}
        </div>
      {/if}
    </section>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ⌘↵ save</span>
      <span class="footer-actions">
        <button class="btn secondary" onclick={onCancel}>Cancel</button>
        <button class="btn primary" disabled={!canSave} onclick={handleSave}>
          {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
        </button>
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
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
    width: 520px;
    max-width: 100%;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }
  .card-header { padding: 18px 22px 12px; }
  .eyebrow-row {
    margin-bottom: 8px;
  }
  .name-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 15px;
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .body {
    padding: 8px 22px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    overflow: hidden;
  }
  .kind-row {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--text-muted);
    padding-bottom: 4px;
  }
  .kind-radio {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .kind-radio input { cursor: pointer; }
  .rule-label {
    font-size: 12px;
    color: var(--text-muted);
  }
  .rule-label strong { color: var(--text); font-weight: 500; }
  .status-list {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    padding: 4px 0;
  }
  .tag-filter-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
  }
  .tag-filter {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12px;
    outline: none;
    padding: 0;
  }
  .picked-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .tag-list {
    flex: 1;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 0;
    background: var(--bg);
  }
  .empty {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }
  .tag-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    cursor: pointer;
  }
  .tag-row:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  .tag-row.checked .tag-name { color: var(--accent); }
  .tag-row input { cursor: pointer; }
  .tag-name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag-count {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
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
  .primary:disabled { opacity: 0.4; cursor: default; }
</style>
