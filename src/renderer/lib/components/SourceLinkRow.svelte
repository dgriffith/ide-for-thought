<script lang="ts">
  // One click-to-navigate list row: an accent title plus an optional secondary
  // line supplied by the caller (#1628). Extracted from the notes / references /
  // backlinks lists in SourceDetail, which repeated this <li> + title + a11y
  // boilerplate three times with only the meta content differing. Rendered
  // inside a NavList (<ul>).
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    onClick: () => void;
    /** Reference-mining stub (#106): italicise + dim the title. */
    stub?: boolean;
    /** Secondary content (path / badge / kind+excerpt) — authored by the
     *  caller, so its own styling stays scoped to the caller. */
    meta?: Snippet;
  }

  let { title, onClick, stub = false, meta }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li onclick={onClick} class:stub-row={stub}>
  <span class="row-title">{title}</span>
  {@render meta?.()}
</li>

<style>
  li {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  li:hover { background: var(--bg-button); }
  li:last-child { border-bottom: none; }

  .row-title { color: var(--accent); }

  /* Stub source from reference mining (#106): italic title, dimmed for visual
     distinction from fully-ingested sources. */
  li.stub-row .row-title {
    font-family: var(--font-display);
    font-style: italic;
    color: color-mix(in oklch, var(--accent) 60%, var(--text-muted));
  }
</style>
