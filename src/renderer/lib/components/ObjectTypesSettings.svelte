<script lang="ts">
  /**
   * Object Types settings panel (#1584) — an in-app home to see and manage
   * object types, so a user no longer hand-authors `.minerva/types/*.md`. Lists
   * stock (read-only) + user types with their icon, property count, and live
   * instance count; user types can be duplicated or deleted. Mutations route
   * through the object-types store (renderer data-flow rule); editing a type's
   * fields lands with the type editor (#1585).
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { objectTypesStore } from '../stores/object-types.svelte';
  import { getDialogStore } from '../stores/dialogs.svelte';
  import { getToastStore } from '../stores/toasts.svelte';
  import TypeEditorDialog from './TypeEditorDialog.svelte';
  import { optionalTypeFields, type TypeEditorInitial } from './type-editor-value';
  import type { TypeInfo } from '../../../shared/objects/type-def';

  const { showConfirm, showPrompt } = getDialogStore();
  const toasts = getToastStore();

  let counts = $state<Record<string, number>>({});
  let busy = $state(false);
  // The type editor (#1585): open with a blank value (New) or an existing type (Edit).
  let editorInitial = $state<TypeEditorInitial | null>(null);
  let editorOpen = $state(false);

  function openNew(): void { editorInitial = { label: '', properties: [] }; editorOpen = true; }
  function openEdit(t: TypeInfo): void {
    editorInitial = {
      id: t.id, label: t.label, properties: t.properties,
      ...optionalTypeFields(t),
    };
    editorOpen = true;
  }

  async function loadCounts(): Promise<void> {
    const { results } = await api.graph.query(
      `SELECT ?id (COUNT(?x) AS ?n) WHERE { ?x a ?c . ?c minerva:typeId ?id } GROUP BY ?id`,
    );
    const out: Record<string, number> = {};
    for (const r of results as Array<{ id?: string; n?: string }>) if (r.id) out[r.id] = Number(r.n ?? 0);
    counts = out;
  }

  async function refresh(): Promise<void> {
    await Promise.all([objectTypesStore.refresh(), loadCounts()]);
  }
  onMount(refresh);

  async function duplicate(t: TypeInfo): Promise<void> {
    busy = true;
    try {
      await objectTypesStore.save({
        label: `${t.label} copy`,
        properties: t.properties,
        ...optionalTypeFields(t),
      });
    } finally { busy = false; }
  }

  async function remove(t: TypeInfo): Promise<void> {
    const n = counts[t.id] ?? 0;
    const msg = n > 0
      ? `Delete the “${t.label}” type? ${n} note${n === 1 ? '' : 's'} still reference${n === 1 ? 's' : ''} it.`
      : `Delete the “${t.label}” type?`;
    if (!(await showConfirm(msg, 'delete-object-type', 'Delete'))) return;
    // When instances exist, offer to clear their `type:` so they aren't left
    // pointing at a type that no longer resolves (#1588).
    let clear = false;
    if (n > 0) {
      clear = await showConfirm(
        `Also remove “type: ${t.id}” from those ${n} note${n === 1 ? '' : 's'}? Otherwise they keep it and it simply won't resolve (reversible either way).`,
        'clear-type-on-delete', 'Remove from notes',
      );
    }
    busy = true;
    try {
      const { cleared, failed } = await objectTypesStore.removeSafely(t.id, clear);
      await loadCounts();
      if (cleared.length > 0) toasts.push({ message: `Deleted “${t.label}” and cleared it from ${cleared.length} note${cleared.length === 1 ? '' : 's'}.` });
      if (failed.length > 0) toasts.push({ message: `Deleted “${t.label}”, but ${failed.length} note${failed.length === 1 ? '' : 's'} couldn’t be cleared — ${failed.length === 1 ? 'it' : 'they'} still list this type.` });
    } finally { busy = false; }
  }

  async function rename(t: TypeInfo): Promise<void> {
    const newName = (await showPrompt('Rename type to:', { initial: t.label }))?.trim();
    if (!newName || newName === t.label) return;
    busy = true;
    try {
      const { migrated, failed } = await objectTypesStore.rename(t.id, newName);
      await loadCounts();
      if (failed.length > 0) {
        toasts.push({ message: `Renamed to “${newName}” — migrated ${migrated.length} note${migrated.length === 1 ? '' : 's'}, but ${failed.length} couldn’t be migrated, so the old type was kept to avoid orphaning ${failed.length === 1 ? 'it' : 'them'}.` });
      } else {
        toasts.push({ message: migrated.length > 0
          ? `Renamed to “${newName}” — migrated ${migrated.length} note${migrated.length === 1 ? '' : 's'}.`
          : `Renamed to “${newName}”.` });
      }
    } finally { busy = false; }
  }
</script>

<div class="object-types">
  <div class="head">
    <p class="hint">
      Object types let notes act as first-class objects (Book, Person, Meeting…). Create one here or from any
      note with <strong>File → Save Note as Object Type</strong>; stock types are read-only.
    </p>
    <button class="new-btn" onclick={openNew}>+ New type</button>
  </div>

  {#if objectTypesStore.errors.length > 0}
    <div class="errors">
      {#each objectTypesStore.errors as e (e.filePath)}
        <div class="error-row"><span class="error-label">{e.label}</span> — {e.message}</div>
      {/each}
    </div>
  {/if}

  {#if objectTypesStore.types.length === 0}
    <p class="empty">No object types yet.</p>
  {:else}
    <ul class="type-list">
      {#each objectTypesStore.types as t (t.id)}
        <li class="type-row">
          <span class="type-icon" style={t.color ? `color:${t.color}` : undefined}>{t.icon ?? '◆'}</span>
          <span class="type-main">
            <span class="type-label">{t.label}</span>
            <span class="type-meta">
              {t.properties.length} propert{t.properties.length === 1 ? 'y' : 'ies'}
              · {counts[t.id] ?? 0} instance{(counts[t.id] ?? 0) === 1 ? '' : 's'}
            </span>
          </span>
          <span class="type-src" class:user={t.source === 'user'}>{t.source}</span>
          {#if t.source === 'user'}
            <span class="type-actions">
              <button class="link-btn" disabled={busy} onclick={() => openEdit(t)}>Edit</button>
              <button class="link-btn" disabled={busy} onclick={() => { void rename(t); }}>Rename</button>
              <button class="link-btn" disabled={busy} onclick={() => { void duplicate(t); }}>Duplicate</button>
              <button class="link-btn" disabled={busy} onclick={() => { void remove(t); }}>Delete</button>
            </span>
          {:else}
            <span class="type-actions muted">read-only</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if editorOpen}
  <TypeEditorDialog
    initial={editorInitial}
    onClose={() => { editorOpen = false; }}
    onSaved={() => { editorOpen = false; void refresh(); }}
  />
{/if}

<style>
  .object-types { display: flex; flex-direction: column; gap: 10px; }
  .head { display: flex; align-items: flex-start; gap: 12px; }
  .hint { flex: 1; font-size: 12.5px; color: var(--text-muted); margin: 0; line-height: 1.5; }
  .new-btn {
    flex-shrink: 0; padding: 5px 12px; border: 1px solid var(--accent); border-radius: 6px;
    background: color-mix(in oklch, var(--accent) 12%, transparent); color: var(--accent);
    font-family: inherit; font-size: 12px; cursor: pointer;
  }
  .new-btn:hover { background: color-mix(in oklch, var(--accent) 20%, transparent); }
  .empty { font-size: 13px; color: var(--text-faint); }
  .errors { display: flex; flex-direction: column; gap: 2px; }
  .error-row { font-size: 11.5px; color: var(--text-muted); }
  .error-label { font-family: var(--font-mono); }
  .type-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .type-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 6px; }
  .type-row:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  .type-icon { font-size: 16px; width: 20px; text-align: center; flex-shrink: 0; }
  .type-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .type-label { font-size: 13px; font-weight: 500; color: var(--text); }
  .type-meta { font-size: 11px; color: var(--text-faint); }
  .type-src {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 1px 6px; border-radius: 3px; color: var(--text-faint);
    background: color-mix(in oklch, var(--text) 6%, transparent);
  }
  .type-src.user { color: var(--accent); background: color-mix(in oklch, var(--accent) 12%, transparent); }
  .type-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .type-actions.muted { color: var(--text-faint); font-size: 11px; }
  .link-btn {
    border: none; background: none; color: var(--accent); font-family: inherit; font-size: 12px; cursor: pointer; padding: 0;
  }
  .link-btn:hover:not(:disabled) { text-decoration: underline; }
  .link-btn:disabled { opacity: 0.5; cursor: default; }
</style>
