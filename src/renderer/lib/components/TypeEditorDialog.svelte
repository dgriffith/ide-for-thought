<script lang="ts">
  /**
   * Type editor (#1585) — author an object type's fields without hand-writing
   * markdown: label, icon, color, cover, and its property list (add / remove /
   * reorder; per property name, type, enum options, link-to-type target, and
   * whether it shows on the card). Saves the full `TypeDef` through the
   * object-types store, which round-trips through parse.ts.
   *
   * Opened blank (New), pre-filled from an existing type (Edit), or pre-filled
   * from a note ("Save Note as Object Type"). Editing keeps the original id.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { objectTypesStore } from '../stores/object-types.svelte';
  import { PROPERTY_TYPES, type PropertyDef, type PropertyType } from '../../../shared/objects/type-def';
  import type { TypeEditorInitial } from './type-editor-value';

  interface Props {
    initial: TypeEditorInitial | null;
    onClose: () => void;
    onSaved?: (id: string) => void;
  }
  let { initial, onClose, onSaved }: Props = $props();
  // The editor seeds its form from `initial` ONCE (it's a draft to edit, not a
  // live binding); capture it so the one-time reads below aren't flagged.
  const seed = initial;

  interface Row {
    name: string;
    type: PropertyType;
    options: string;   // comma-separated (enum)
    targetType: string; // link-to-type target id
    onCard: boolean;
  }

  let label = $state(seed?.label ?? '');
  let icon = $state(seed?.icon ?? '');
  let color = $state(seed?.color ?? '');
  let cover = $state(seed?.cover ?? '');
  let rows = $state<Row[]>(
    (seed?.properties ?? []).map((p) => ({
      name: p.name,
      type: p.type,
      options: (p.options ?? []).join(', '),
      targetType: p.targetType ?? '',
      onCard: (seed?.card ?? []).includes(p.name),
    })),
  );
  let saving = $state(false);
  let error = $state('');

  // Existing type ids for the link-to-type target dropdown.
  let typeIds = $state<string[]>([]);
  onMount(async () => {
    const cat = await api.types.list();
    typeIds = cat.types.map((t) => t.id).filter((id) => id !== initial?.id);
  });

  const propNames = $derived(rows.map((r) => r.name.trim()).filter(Boolean));

  function addRow(): void {
    rows = [...rows, { name: '', type: 'text', options: '', targetType: '', onCard: false }];
  }
  function removeRow(i: number): void { rows = rows.filter((_, j) => j !== i); }
  function move(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    rows = next;
  }

  function buildProperties(): PropertyDef[] {
    return rows
      .filter((r) => r.name.trim())
      .map((r) => {
        const p: PropertyDef = { name: r.name.trim(), type: r.type };
        if (r.type === 'enum') p.options = r.options.split(',').map((s) => s.trim()).filter(Boolean);
        if (r.type === 'link-to-type' && r.targetType.trim()) p.targetType = r.targetType.trim();
        return p;
      });
  }

  async function save(): Promise<void> {
    if (!label.trim()) { error = 'A type needs a name.'; return; }
    saving = true;
    error = '';
    try {
      const props = buildProperties();
      const cardNames = rows.filter((r) => r.onCard && r.name.trim()).map((r) => r.name.trim());
      const result = await objectTypesStore.save({
        label: label.trim(),
        ...(initial?.id ? { id: initial.id } : {}),
        properties: props,
        ...(icon.trim() ? { icon: icon.trim() } : {}),
        ...(color.trim() ? { color: color.trim() } : {}),
        ...(cover && propNames.includes(cover) ? { cover } : {}),
        ...(cardNames.length > 0 ? { card: cardNames } : {}),
        ...(initial?.template ? { template: initial.template } : {}),
      });
      onSaved?.(result.id);
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      saving = false;
    }
  }

  function overlayKey(e: KeyboardEvent): void { if (e.key === 'Escape') onClose(); }
</script>

<div class="overlay" onkeydown={overlayKey} onmousedown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Edit object type">
    <h3 class="title">{initial?.id ? 'Edit' : 'New'} object type</h3>

    <div class="meta">
      <label class="field grow"><span>Name</span>
        <input bind:value={label} placeholder="Book" />
      </label>
      <label class="field narrow"><span>Icon</span>
        <input bind:value={icon} placeholder="📖" maxlength="4" />
      </label>
      <label class="field narrow"><span>Color</span>
        <input bind:value={color} placeholder="#89b4fa" />
      </label>
    </div>

    <div class="props-head">
      <span class="props-title">Properties</span>
      <button class="btn small" onclick={addRow}>+ Add property</button>
    </div>
    {#if rows.length === 0}
      <p class="muted">No properties yet — a type can be property-less, or add some.</p>
    {/if}
    <ul class="prop-list">
      {#each rows as row, i (i)}
        <li class="prop-row">
          <input class="p-name" bind:value={row.name} placeholder="author" />
          <select class="p-type" bind:value={row.type}>
            {#each PROPERTY_TYPES as pt (pt)}<option value={pt}>{pt}</option>{/each}
          </select>
          {#if row.type === 'enum'}
            <input class="p-extra" bind:value={row.options} placeholder="option, option" title="Enum options (comma-separated)" />
          {:else if row.type === 'link-to-type'}
            <select class="p-extra" bind:value={row.targetType} title="Target type">
              <option value="">(any type)</option>
              {#each typeIds as tid (tid)}<option value={tid}>{tid}</option>{/each}
            </select>
          {:else}
            <span class="p-extra"></span>
          {/if}
          <label class="p-card" title="Show on the type-keyed card"><input type="checkbox" bind:checked={row.onCard} /> card</label>
          <span class="p-actions">
            <button class="icon-btn" title="Move up" aria-label="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
            <button class="icon-btn" title="Move down" aria-label="Move down" disabled={i === rows.length - 1} onclick={() => move(i, 1)}>↓</button>
            <button class="icon-btn" title="Remove" aria-label="Remove" onclick={() => removeRow(i)}>×</button>
          </span>
        </li>
      {/each}
    </ul>

    <label class="field cover"><span>Cover (gallery image)</span>
      <select bind:value={cover}>
        <option value="">(none)</option>
        {#each propNames as n (n)}<option value={n}>{n}</option>{/each}
      </select>
    </label>

    {#if error}<p class="error">{error}</p>{/if}

    <div class="actions">
      <button class="btn" onclick={onClose}>Cancel</button>
      <button class="btn primary" disabled={saving || !label.trim()} onclick={save}>{initial?.id ? 'Save' : 'Create'}</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1100; }
  .dialog {
    width: 640px; max-width: 92vw; max-height: 85vh; overflow-y: auto;
    background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.45);
  }
  .title { margin: 0 0 14px; font-size: 15px; color: var(--text); }
  .meta { display: flex; gap: 10px; margin-bottom: 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field span { font-size: 11px; color: var(--text-muted); }
  .field.grow { flex: 1; }
  .field.narrow { width: 90px; }
  .field input, .field select, .prop-row input, .prop-row select {
    padding: 5px 8px; border: 1px solid var(--border); border-radius: 5px;
    background: var(--bg-inset); color: var(--text); font-family: inherit; font-size: 13px;
  }
  .props-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .props-title { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .muted { font-size: 12px; color: var(--text-faint); margin: 2px 0 8px; }
  .prop-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .prop-row { display: flex; align-items: center; gap: 6px; }
  .p-name { flex: 1; min-width: 0; }
  .p-type { width: 110px; }
  .p-extra { width: 140px; flex-shrink: 0; }
  .p-card { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
  .p-actions { display: flex; gap: 1px; flex-shrink: 0; }
  .icon-btn {
    width: 22px; height: 24px; border: 1px solid var(--border); border-radius: 4px;
    background: var(--bg-button); color: var(--text-muted); cursor: pointer; font-size: 12px;
  }
  .icon-btn:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }
  .field.cover { max-width: 260px; margin-bottom: 12px; }
  .error { color: var(--accent); font-size: 12px; margin: 0 0 10px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn {
    padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--bg-button); color: var(--text); font-family: inherit; font-size: 12px; cursor: pointer;
  }
  .btn:hover:not(:disabled) { border-color: var(--accent); }
  .btn.small { padding: 3px 10px; font-size: 11.5px; }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .btn:disabled { opacity: 0.5; cursor: default; }
</style>
