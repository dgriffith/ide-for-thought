<script lang="ts">
  interface Option {
    value: string;
    label: string;
    /** Optional count or trailing string (e.g. "23 matches"). */
    sub?: string;
  }

  interface Props {
    value: string;
    options: ReadonlyArray<Option>;
    onchange?: (next: string) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }

  let {
    value = $bindable(''),
    options,
    onchange,
    disabled = false,
    'aria-label': ariaLabel,
  }: Props = $props();

  function pick(next: string) {
    if (disabled || next === value) return;
    value = next;
    onchange?.(next);
  }
</script>

<div class="segmented" role="tablist" aria-label={ariaLabel}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      role="tab"
      class="segment"
      class:active={value === opt.value}
      aria-selected={value === opt.value}
      {disabled}
      onclick={() => pick(opt.value)}
    >
      {opt.label}{#if opt.sub}<span class="sub">{opt.sub}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  .segment {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 12px;
    font-weight: 450;
    cursor: pointer;
    white-space: nowrap;
  }
  .segment:hover:not(.active):not(:disabled) {
    color: var(--text);
  }
  .segment.active {
    background: var(--bg-elev);
    color: var(--text);
    font-weight: 500;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
  .segment:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .sub {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .segment.active .sub {
    color: var(--text-muted);
  }
</style>
