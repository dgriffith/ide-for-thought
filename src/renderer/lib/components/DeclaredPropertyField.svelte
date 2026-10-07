<script lang="ts">
  /**
   * The widget for one DECLARED property of a type (#1063 schema) — enum →
   * its options, number / date → the native inputs, boolean → a checkbox,
   * datetime → a typed ISO field plus a picker, anything else → text.
   *
   * `datetime` (#2613) is a TEXT field, not a native `datetime-local`: the
   * type accepts a date-only or partial value (`2026-10-05`, `1969`) meaning
   * that span, and a native control can't hold one — it would blank the field
   * or force a full timestamp. What you type is committed as written. The
   * picker beside it writes a full `YYYY-MM-DDTHH:mm` (floating local time).
   * A value the type can't read is marked invalid, never rewritten. Extracted from the Properties panel's declared form
   * (#2431) so the bulk "Edit properties…" dialog edits a selection with the
   * very same widgets the panel uses for one note.
   *
   * Presentational: it holds no committed state. `onCommit` fires on change
   * with the raw text ('true'/'false' for a checkbox); the host decides what
   * that means (the panel writes the note, the bulk dialog records an edit).
   */
  import type { PropertyDef } from '../../../shared/objects/type-def';
  import { parseDateValue } from '../../../shared/objects/date-precision';

  interface Props {
    def: PropertyDef;
    /** Current value as text ('' = unset). */
    text: string;
    /** Accessible name for the control (the visible label sits beside it). */
    label?: string;
    /** Declared but not set on the note: drawn dashed, a prompt not an error. */
    unset?: boolean;
    /** The selection disagrees (bulk editing): placeholder / indeterminate. */
    mixed?: boolean;
    onCommit: (raw: string) => void;
  }

  let { def, text, label, unset = false, mixed = false, onCommit }: Props = $props();

  // `indeterminate` is a DOM property with no attribute, so set it directly.
  let checkbox = $state<HTMLInputElement>();
  $effect(() => { if (checkbox) checkbox.indeterminate = mixed; });

  const placeholder = $derived(mixed ? 'Mixed' : def.type === 'link-to-type' ? '[[Note]]' : def.type === 'datetime' ? 'YYYY-MM-DDTHH:mm' : '');

  // datetime: unreadable text is flagged, not corrected. The picker opens on a
  // full floating minute value, or empty for anything else.
  const dtInvalid = $derived(def.type === 'datetime' && text.trim() !== '' && parseDateValue(text) === null);
  const pickerValue = $derived(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text.trim()) ? text.trim() : '');
  let picker = $state<HTMLInputElement>();
  function openPicker(): void {
    try { picker?.showPicker(); } catch { picker?.focus(); }
  }
</script>

{#if def.type === 'boolean'}
  <label class="dpf-bool">
    <input
      type="checkbox"
      aria-label={label}
      checked={text === 'true'}
      bind:this={checkbox}
      onchange={(e) => onCommit(String(e.currentTarget.checked))}
    />
    <span>{mixed ? 'Mixed' : text === 'true' ? 'Yes' : 'No'}</span>
  </label>
{:else if def.type === 'enum'}
  <select class="dpf" class:unset aria-label={label} value={text} onchange={(e) => onCommit(e.currentTarget.value)}>
    <option value="">{mixed ? 'Mixed' : ''}</option>
    {#each def.options ?? [] as opt (opt)}<option value={opt}>{opt}</option>{/each}
  </select>
{:else if def.type === 'number'}
  <input class="dpf" class:unset type="number" aria-label={label} value={text} {placeholder} onchange={(e) => onCommit(e.currentTarget.value)} />
{:else if def.type === 'datetime'}
  <span class="dpf-dt">
    <input
      class="dpf" class:unset type="text" aria-label={label} value={text} {placeholder}
      spellcheck="false" autocomplete="off" aria-invalid={dtInvalid || undefined}
      title={dtInvalid ? 'Not a date: write YYYY-MM-DD, YYYY-MM or YYYY, optionally with THH:mm' : undefined}
      onchange={(e) => onCommit(e.currentTarget.value.trim())}
    />
    <button type="button" class="dpf-pick" aria-label={`Pick ${label ?? def.label ?? def.name}`} onclick={openPicker}>▾</button>
    <input
      class="dpf-picker" type="datetime-local" tabindex="-1" aria-hidden="true" value={pickerValue} bind:this={picker}
      onchange={(e) => { if (e.currentTarget.value) onCommit(e.currentTarget.value); }}
    />
  </span>
{:else if def.type === 'date'}
  <input class="dpf" class:unset class:mixed type="date" aria-label={label} value={text} onchange={(e) => onCommit(e.currentTarget.value)} />
{:else}
  <input class="dpf" class:unset type="text" aria-label={label} value={text} {placeholder} onchange={(e) => onCommit(e.currentTarget.value)} />
{/if}

<style>
  .dpf {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 12.5px;
    box-sizing: border-box;
  }
  .dpf:focus {
    outline: none;
    border-color: var(--accent);
  }
  /* A declared-but-empty field is a prompt, not an error — dim the frame
     slightly so filled fields read first, and no danger styling. */
  .dpf.unset {
    border-style: dashed;
  }
  /* A date input can't show a placeholder; fade its empty mask instead. */
  .dpf.mixed {
    color: var(--text-faint);
  }
  .dpf-dt {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 4px;
  }
  .dpf[aria-invalid='true'] {
    font-style: italic;
    border-style: dotted;
  }
  .dpf-pick {
    flex-shrink: 0;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-button);
    color: var(--text-muted);
    cursor: pointer;
  }
  .dpf-pick:hover {
    color: var(--text);
  }
  /* The native control only supplies the popup; it sits under the button. */
  .dpf-picker {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .dpf-bool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .dpf-bool input {
    cursor: pointer;
    accent-color: var(--accent);
  }
</style>
