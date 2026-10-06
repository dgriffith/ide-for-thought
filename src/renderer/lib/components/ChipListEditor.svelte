<script lang="ts" module>
  export interface Chip {
    label: string;
    /** Small trailing note, e.g. how many of the selection hold the value. */
    detail?: string | undefined;
    state?: 'adding' | 'removing' | undefined;
    /** Accessible name for the chip's button; default "Remove <label>". */
    actionLabel?: string | undefined;
  }
</script>

<script lang="ts">
  /**
   * A list value as removable chips plus an "Add…" input — the Properties
   * panel's string-list editor, extracted (#2431) so the bulk "Edit
   * properties…" dialog's tags / aliases / link fields use the same widget.
   *
   * Presentational: the host owns the list. `onAdd` fires on Enter or `,` with
   * the trimmed text; `onRemove` with the chip's index. A chip may carry a
   * `detail` (bulk: "2/5" notes hold it) and a `state` the host uses to show a
   * pending add / remove before anything is written.
   */

  interface Props {
    chips: Chip[];
    onAdd: (value: string) => void;
    onRemove: (index: number) => void;
    placeholder?: string;
    /** Accessible name for the add input. */
    inputLabel?: string;
    /** Autocomplete values for the add input. */
    suggestions?: string[];
    /** False → chips only, no add input (a list you can only remove from). */
    addable?: boolean;
  }

  let { chips, onAdd, onRemove, placeholder = 'Add…', inputLabel, suggestions = [], addable = true }: Props = $props();

  let draft = $state('');
  const listId = `chip-suggest-${Math.random().toString(36).slice(2, 9)}`;

  function commit(): void {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    draft = '';
  }
</script>

<div class="chips">
  {#each chips as chip, i (chip.label + ':' + i)}
    <span class="chip" class:adding={chip.state === 'adding'} class:removing={chip.state === 'removing'}>
      <span class="chip-label">{chip.label}</span>
      {#if chip.detail}<span class="chip-detail">{chip.detail}</span>{/if}
      <button
        type="button"
        class="chip-x"
        title={chip.actionLabel ?? 'Remove'}
        aria-label={chip.actionLabel ?? `Remove ${chip.label}`}
        onclick={() => onRemove(i)}
      >{chip.state === 'removing' ? '↺' : '×'}</button>
    </span>
  {/each}
  {#if addable}
  <input
    type="text"
    class="chip-input"
    {placeholder}
    aria-label={inputLabel}
    list={suggestions.length > 0 ? listId : undefined}
    autocomplete="off"
    value={draft}
    oninput={(e) => { draft = e.currentTarget.value; }}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commit();
      }
    }}
  />
  {/if}
  {#if addable && suggestions.length > 0}
    <datalist id={listId}>
      {#each suggestions as s (s)}<option value={s}></option>{/each}
    </datalist>
  {/if}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-button);
    color: var(--text);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 11px;
  }
  /* Pending bulk edits: an add is outlined in accent, a removal struck through
     — neutral treatments, not danger styling. */
  .chip.adding {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .chip.removing .chip-label {
    text-decoration: line-through;
    color: var(--text-faint);
  }
  .chip-detail {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-faint);
  }
  .chip-x {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }
  .chip-x:hover { color: var(--text); }
  .chip-input {
    flex: 1;
    min-width: 60px;
    background: none;
    border: 1px dashed var(--border);
    border-radius: 10px;
    padding: 1px 6px;
    color: var(--text);
    font-size: 11px;
  }
  .chip-input:focus {
    border-style: solid;
    border-color: var(--accent);
    outline: none;
  }
</style>
