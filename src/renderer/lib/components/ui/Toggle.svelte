<script lang="ts">
  interface Props {
    /** The on/off state. Use bind:checked to mutate from the parent. */
    checked: boolean;
    /** Optional change callback (alternative to bind:checked). */
    onchange?: (next: boolean) => void;
    /** Disabled state — visual + interactive. */
    disabled?: boolean;
    /** Accessible label (provided by a sibling SettingRow label when in a form). */
    'aria-label'?: string;
    'aria-labelledby'?: string;
  }

  let {
    checked = $bindable(false),
    onchange,
    disabled = false,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
  }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledBy}
  {disabled}
  class="toggle"
  class:on={checked}
  onclick={toggle}
>
  <span class="thumb" class:on={checked}></span>
</button>

<style>
  .toggle {
    display: inline-flex;
    width: 32px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: var(--border-strong);
    position: relative;
    cursor: pointer;
    transition: background 0.15s;
    vertical-align: middle;
  }
  .toggle.on {
    background: var(--accent);
  }
  .toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: white;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: left 0.15s;
  }
  .thumb.on {
    left: 16px;
  }
</style>
