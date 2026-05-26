<script lang="ts">
  import type { Snippet } from 'svelte';

  type Tone = 'default' | 'accent' | 'sage' | 'rust' | 'iris' | 'muted';
  type Size = 'sm' | 'md';

  interface Props {
    /** Visual tone. 'accent' uses --accent, 'sage'/'rust'/'iris' for typed
     *  signals, 'muted' for de-emphasized chips. */
    tone?: Tone;
    /** 'sm' (default) is the everyday chip; 'md' bumps padding + font size
     *  for the "big" weighted-tag variant in §5.4. */
    size?: Size;
    /** When provided, the chip renders as a <button>; otherwise a <span>. */
    onclick?: (e: MouseEvent) => void;
    /** Native title (tooltip). */
    title?: string;
    children: Snippet;
  }

  let { tone = 'default', size = 'sm', onclick, title, children }: Props = $props();
</script>

{#if onclick}
  <button type="button" class="chip" class:big={size === 'md'} data-tone={tone} {title} {onclick}>
    {@render children()}
  </button>
{:else}
  <span class="chip" class:big={size === 'md'} data-tone={tone} {title}>
    {@render children()}
  </span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-family: inherit;
    font-size: 11.5px;
    line-height: 1.2;
    cursor: default;
    white-space: nowrap;
  }
  button.chip {
    cursor: pointer;
  }
  .chip.big {
    padding: 4px 10px;
    font-size: 12.5px;
  }
  .chip[data-tone='accent'] {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 30%, transparent);
  }
  .chip[data-tone='sage'] {
    background: color-mix(in oklch, var(--sage) 14%, transparent);
    color: var(--sage);
    border-color: color-mix(in oklch, var(--sage) 30%, transparent);
  }
  .chip[data-tone='rust'] {
    background: color-mix(in oklch, var(--rust) 14%, transparent);
    color: var(--rust);
    border-color: color-mix(in oklch, var(--rust) 30%, transparent);
  }
  .chip[data-tone='iris'] {
    background: color-mix(in oklch, var(--iris) 14%, transparent);
    color: var(--iris);
    border-color: color-mix(in oklch, var(--iris) 30%, transparent);
  }
  .chip[data-tone='muted'] {
    color: var(--text-muted);
  }
</style>
