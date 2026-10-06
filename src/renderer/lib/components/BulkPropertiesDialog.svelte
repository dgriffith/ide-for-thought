<script lang="ts">
  /**
   * "Edit properties…" for a selection of notes (#2431). Shows the selection's
   * shared type schema (or, for mixed types, the properties they all declare)
   * plus title / aliases / tags, with the same widgets the Properties panel uses
   * for one note (DeclaredPropertyField, ChipListEditor). Where the notes
   * disagree a field reads "Mixed".
   *
   * Nothing is written here: the dialog resolves with the list of edits for the
   * fields the user actually touched, and the bulk-property ops write those —
   * and only those — to every note in one pass.
   */
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import Dialog from './ui/Dialog.svelte';
  import DeclaredPropertyField from './DeclaredPropertyField.svelte';
  import ChipListEditor, { type Chip } from './ChipListEditor.svelte';
  import PropertyValueEditor from './PropertyValueEditor.svelte';
  import {
    scalarEditFor,
    normalizeListValue,
    type BulkEdit,
    type BulkField,
    type BulkFieldModel,
  } from '../../../shared/objects/bulk-properties';
  import { SCALAR_TYPES, coerceScalar, isValidScalar, type ScalarType } from '../../../shared/refactor/property-shape';

  interface Props {
    model: BulkFieldModel;
    /** Tag vocabulary for the tags field's autocomplete. */
    tagSuggestions?: string[];
    onConfirm: (edits: BulkEdit[]) => void;
    onCancel: () => void;
  }

  let { model, tagSuggestions = [], onConfirm, onCancel }: Props = $props();

  type ScalarDraft = { raw: string } | 'clear';
  /** Touched scalar fields only — an untouched field is never an edit. */
  const scalarDrafts = new SvelteMap<string, ScalarDraft>();
  /** Pending list ops per field. */
  const listAdds = new SvelteMap<string, string[]>();
  const listRemoves = new SvelteMap<string, string[]>();
  const otherRemoves = new SvelteSet<string>();

  let newName = $state('');
  let newType = $state<ScalarType>('string');
  let newText = $state('');
  let newBool = $state(false);

  const noun = $derived(`${model.total} note${model.total === 1 ? '' : 's'}`);
  const schemaFields = $derived(model.fields.filter((f) => f.section === 'schema'));
  const commonFields = $derived(model.fields.filter((f) => f.section === 'common'));

  function listStyle(f: BulkField): 'tags' | 'link' | 'plain' {
    if (f.name === 'tags') return 'tags';
    return f.def.type === 'link-to-type' ? 'link' : 'plain';
  }

  function scalarText(f: BulkField): string {
    const d = scalarDrafts.get(f.name);
    if (d === 'clear') return '';
    return d ? d.raw : f.value;
  }

  function setScalar(f: BulkField, raw: string): void {
    // Re-entering the value every note already shares is not a change.
    if (!f.mixed && raw === f.value) scalarDrafts.delete(f.name);
    else scalarDrafts.set(f.name, { raw });
  }

  function chipsFor(f: BulkField): Chip[] {
    const removes = listRemoves.get(f.name) ?? [];
    const existing: Chip[] = f.items.map((it) => {
      const removing = removes.includes(it.value);
      return {
        label: it.value,
        detail: it.count < model.total ? `${it.count}/${model.total}` : undefined,
        state: removing ? 'removing' : undefined,
        actionLabel: removing ? `Keep ${it.value}` : `Remove ${it.value} from ${noun}`,
      };
    });
    const adds: Chip[] = (listAdds.get(f.name) ?? []).map((v) => ({
      label: v, state: 'adding', actionLabel: `Don't add ${v}`,
    }));
    return [...existing, ...adds];
  }

  function onListRemove(f: BulkField, index: number): void {
    if (index < f.items.length) {
      const v = f.items[index]!.value;
      const cur = listRemoves.get(f.name) ?? [];
      listRemoves.set(f.name, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
      return;
    }
    const adds = listAdds.get(f.name) ?? [];
    listAdds.set(f.name, adds.filter((_, i) => i !== index - f.items.length));
  }

  function onListAdd(f: BulkField, raw: string): void {
    const v = normalizeListValue(listStyle(f), raw);
    const adds = listAdds.get(f.name) ?? [];
    if (adds.includes(v)) return;
    // Adding a value that's pending removal just cancels the removal.
    const removes = listRemoves.get(f.name) ?? [];
    if (removes.includes(v)) { listRemoves.set(f.name, removes.filter((x) => x !== v)); return; }
    listAdds.set(f.name, [...adds, v]);
  }

  function collectEdits(): { edits: BulkEdit[]; invalid: string[] } {
    const edits: BulkEdit[] = [];
    const invalid: string[] = [];
    for (const f of model.fields) {
      if (f.kind === 'scalar') {
        const d = scalarDrafts.get(f.name);
        if (!d) continue;
        if (d === 'clear') { edits.push({ op: 'clear', key: f.name }); continue; }
        const e = scalarEditFor(f.def, d.raw);
        if (e) edits.push(e); else invalid.push(f.label);
      } else {
        const add = listAdds.get(f.name) ?? [];
        const remove = listRemoves.get(f.name) ?? [];
        if (add.length > 0 || remove.length > 0) edits.push({ op: 'list', key: f.name, add, remove, style: listStyle(f) });
      }
    }
    for (const key of otherRemoves) edits.push({ op: 'clear', key });
    const name = newName.trim();
    if (name) {
      if (newType === 'boolean') edits.push({ op: 'set', key: name, value: newBool });
      else if (isValidScalar(newType, newText)) edits.push({ op: 'set', key: name, value: coerceScalar(newType, newText) });
      else invalid.push(name);
    }
    return { edits, invalid };
  }

  const pending = $derived(collectEdits());
  const canApply = $derived(pending.edits.length > 0 && pending.invalid.length === 0);

  function apply(): void {
    if (!canApply) return;
    onConfirm(pending.edits);
  }
</script>

{#snippet field(f: BulkField)}
  {@const draft = scalarDrafts.get(f.name)}
  <div class="bfield" class:touched={!!draft || listAdds.has(f.name) || listRemoves.has(f.name)} data-field={f.name}>
    <span class="bfield-label">{f.label}</span>
    {#if f.kind === 'scalar'}
      <div class="bfield-control">
        <div class="bfield-widget">
          <DeclaredPropertyField
            def={f.def}
            label={f.label}
            text={scalarText(f)}
            mixed={f.mixed && !draft}
            unset={draft === 'clear'}
            onCommit={(raw) => setScalar(f, raw)}
          />
        </div>
        {#if draft}
          <button type="button" class="bfield-btn" aria-label="Revert {f.label}" title="Revert" onclick={() => scalarDrafts.delete(f.name)}>↺</button>
        {:else if f.mixed || f.value !== ''}
          <button type="button" class="bfield-btn" aria-label="Clear {f.label}" title="Clear on every note" onclick={() => scalarDrafts.set(f.name, 'clear')}>×</button>
        {/if}
      </div>
      {#if draft === 'clear'}<span class="bfield-hint">Removed from every note</span>{/if}
    {:else}
      <ChipListEditor
        chips={chipsFor(f)}
        inputLabel="Add to {f.label}"
        placeholder={f.def.type === 'link-to-type' ? 'Add link…' : 'Add…'}
        suggestions={f.name === 'tags' ? tagSuggestions : []}
        onAdd={(v) => onListAdd(f, v)}
        onRemove={(i) => onListRemove(f, i)}
      />
    {/if}
  </div>
{/snippet}

<Dialog width={540} onClose={onCancel} titleId="bulk-properties-title">
  {#snippet eyebrow()}Properties{/snippet}
  {#snippet title()}Edit properties of {noun}{/snippet}
  {#snippet subtitle()}
    {#if model.sharedType}
      All {model.sharedType.label}.
    {:else if model.hasUntyped}
      Some notes have no type — showing the fields every note has.
    {:else}
      Mixed types ({model.typeLabels.join(', ')}) — showing the properties they share.
    {/if}
    Only the fields you change are written.
  {/snippet}
  {#snippet body()}
    <div class="bulk-body">
      {#if model.unparseable.length > 0}
        <p class="bulk-note">
          {model.unparseable.length} note{model.unparseable.length === 1 ? ' has' : 's have'} a YAML error and will be skipped.
        </p>
      {/if}
      {#if schemaFields.length > 0}
        <div class="bulk-section">
          {#each schemaFields as f (f.name)}{@render field(f)}{/each}
        </div>
        <div class="section-rule"><span>Common</span></div>
      {/if}
      <div class="bulk-section">
        {#each commonFields as f (f.name)}{@render field(f)}{/each}
      </div>

      <div class="section-rule"><span>Other properties</span></div>
      {#if model.otherKeys.length > 0}
        <ChipListEditor
          chips={model.otherKeys.map((k) => {
            const removing = otherRemoves.has(k.value);
            return {
              label: k.value,
              detail: k.count < model.total ? `${k.count}/${model.total}` : undefined,
              state: removing ? 'removing' : undefined,
              actionLabel: removing ? `Keep ${k.value}` : `Remove ${k.value} from ${noun}`,
            } satisfies Chip;
          })}
          addable={false}
          onAdd={() => {}}
          onRemove={(i) => {
            const k = model.otherKeys[i]!.value;
            if (otherRemoves.has(k)) otherRemoves.delete(k); else otherRemoves.add(k);
          }}
        />
      {/if}
      <div class="add-other">
        <input class="add-name" type="text" aria-label="New property name" placeholder="Add property…" bind:value={newName} autocomplete="off" />
        <select class="add-type" aria-label="New property type" bind:value={newType}>
          {#each SCALAR_TYPES as t (t)}<option value={t}>{t}</option>{/each}
        </select>
        <div class="add-value">
          <PropertyValueEditor
            type={newType}
            text={newText}
            checked={newBool}
            onInput={(raw) => { newText = raw; }}
            onCommit={(raw) => { newText = raw; }}
            onToggle={(c) => { newBool = c; }}
          />
        </div>
      </div>
    </div>
  {/snippet}
  {#snippet footerLeft()}<span class="kbd-hint">esc · cancel</span>{/snippet}
  {#snippet footerRight()}
    <button class="btn secondary" onclick={onCancel}>Cancel</button>
    <button class="btn primary" disabled={!canApply} onclick={apply}>Apply to {noun}</button>
  {/snippet}
</Dialog>

<style>
  .bulk-body { display: flex; flex-direction: column; gap: 10px; }
  .bulk-section { display: flex; flex-direction: column; gap: 9px; }
  .bulk-note { margin: 0; font-size: 12px; color: var(--text-muted); }
  .bfield { display: flex; flex-direction: column; gap: 3px; }
  .bfield-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .bfield.touched .bfield-label { color: var(--accent); }
  .bfield-control { display: flex; align-items: center; gap: 6px; }
  .bfield-widget { flex: 1; min-width: 0; }
  .bfield-btn {
    border: none;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
    font-size: 13px;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .bfield-btn:hover { color: var(--text); background: var(--bg-button); }
  .bfield-hint { font-size: 11px; color: var(--text-faint); }
  .section-rule {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .section-rule::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .add-other { display: flex; gap: 6px; align-items: center; }
  .add-name, .add-type {
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
  }
  .add-name { flex: 1 1 40%; min-width: 0; }
  .add-type { flex: 0 0 84px; }
  .add-value { flex: 1 1 40%; min-width: 0; }
  .kbd-hint { font-size: 10.5px; color: var(--text-faint); font-family: var(--font-mono); }
  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
  }
  .secondary { background: transparent; color: var(--text-muted); }
  .secondary:hover { color: var(--text); border-color: var(--border-strong); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
  .primary:hover:not(:disabled) { opacity: 0.92; }
  .primary:disabled { opacity: 0.4; cursor: default; }
</style>
