<script lang="ts">
  /**
   * Type-aware editor for a single scalar frontmatter value (#471 follow-up).
   * Presentational and fully parent-controlled: it holds no committed state,
   * it just renders the widget for `type` and reports edits. The parent owns
   * debounce/commit timing — the Properties panel debounces text into its YAML
   * round-trip; the Add-Property dialog reads the value on submit.
   *
   *   - text/number → `onInput` per keystroke, `onCommit` on blur / Enter
   *   - boolean     → `onToggle` on change (no text)
   *   - date        → `onCommit` on change (native picker commits atomically)
   */
  import type { ScalarType } from '../../../shared/refactor/property-shape';

  interface Props {
    type: ScalarType;
    /** Display text for string / number / date inputs. */
    text?: string;
    /** Checked state for the boolean toggle. */
    checked?: boolean;
    autofocus?: boolean;
    onInput?: (raw: string) => void;
    onCommit?: (raw: string) => void;
    onToggle?: (checked: boolean) => void;
  }

  let {
    type,
    text = '',
    checked = false,
    autofocus = false,
    onInput,
    onCommit,
    onToggle,
  }: Props = $props();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit?.((e.currentTarget as HTMLInputElement).value);
    }
  }
</script>

{#if type === 'boolean'}
  <label class="pve-bool">
    <input
      type="checkbox"
      {checked}
      onchange={(e) => onToggle?.(e.currentTarget.checked)}
    />
    <span>{checked ? 'true' : 'false'}</span>
  </label>
{:else if type === 'number'}
  <!-- svelte-ignore a11y_autofocus -->
  <!-- Edit-in-place: this input replaces the value on a user click, so focusing
       it is the expected behavior, not a surprise focus-steal. -->
  <input
    class="pve-input"
    type="number"
    value={text}
    {autofocus}
    oninput={(e) => onInput?.(e.currentTarget.value)}
    onblur={(e) => onCommit?.(e.currentTarget.value)}
    onkeydown={onKeydown}
  />
{:else if type === 'date'}
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="pve-input"
    type="date"
    value={text}
    {autofocus}
    onchange={(e) => onCommit?.(e.currentTarget.value)}
  />
{:else}
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="pve-input"
    type="text"
    value={text}
    {autofocus}
    spellcheck="false"
    oninput={(e) => onInput?.(e.currentTarget.value)}
    onblur={(e) => onCommit?.(e.currentTarget.value)}
    onkeydown={onKeydown}
  />
{/if}

<style>
  .pve-input {
    width: 100%;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 13px;
    outline: none;
  }
  .pve-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .pve-bool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .pve-bool input {
    cursor: pointer;
    accent-color: var(--accent);
  }
</style>
