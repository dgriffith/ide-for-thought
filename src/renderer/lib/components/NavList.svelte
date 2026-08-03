<script lang="ts">
  // A bare <ul> reset wrapper for click-to-navigate lists (#1628). Pairs with
  // SourceLinkRow, which owns the <li>. Extracted from the three near-identical
  // lists in SourceDetail (notes / references / backlinks).
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<ul class="nav-list">{@render children()}</ul>

<style>
  .nav-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
</style>
