<script lang="ts">
  interface Props {
    value: number;
    onchange?: (next: number) => void;
    step?: number;
    min?: number;
    max?: number;
    /** Trailing unit string (e.g. "px"). Rendered next to the value. */
    unit?: string;
    /** Decimal places for display. Inferred from `step` when omitted. */
    precision?: number;
    disabled?: boolean;
    'aria-label'?: string;
  }

  let {
    value = $bindable(0),
    onchange,
    step = 1,
    min,
    max,
    unit = '',
    precision,
    disabled = false,
    'aria-label': ariaLabel,
  }: Props = $props();

  const decimals = $derived(
    precision ?? (step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0),
  );

  function clamp(n: number) {
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  }

  function bump(delta: number) {
    if (disabled) return;
    const next = clamp(Number((value + delta * step).toFixed(decimals)));
    value = next;
    onchange?.(next);
  }
</script>

<div class="stepper" role="group" aria-label={ariaLabel}>
  <button
    type="button"
    class="step-btn"
    {disabled}
    aria-label="Decrease"
    onclick={() => bump(-1)}
  >−</button>
  <span class="value">{value.toFixed(decimals)}{unit}</span>
  <button
    type="button"
    class="step-btn"
    {disabled}
    aria-label="Increase"
    onclick={() => bump(1)}
  >+</button>
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .step-btn {
    padding: 5px 8px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1;
  }
  .step-btn:hover:not(:disabled) {
    background: var(--bg-elev-2);
    color: var(--text);
  }
  .step-btn:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
  .value {
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    min-width: 48px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
