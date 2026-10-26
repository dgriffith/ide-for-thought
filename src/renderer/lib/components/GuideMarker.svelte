<script lang="ts">
  /**
   * The one quiet line a review shows when a change writes or turns off the
   * thoughtbase guide (#2837). Information, not a gate: no danger styling,
   * no confirm. Whether to show it is `shared/thoughtbase-guide.ts`'s.
   */
  import { GUIDE_MARKER_TEXT, type GuideEffect } from '../../../shared/thoughtbase-guide';

  interface Props {
    effect: GuideEffect;
  }

  let { effect }: Props = $props();
</script>

{#if effect}
  <p class="guide-marker" data-testid="guide-marker">{GUIDE_MARKER_TEXT[effect]}</p>
{/if}

<style>
  .guide-marker {
    margin: 0;
    padding: 3px 8px;
    border-left: 2px solid var(--accent);
    color: var(--text);
    font-size: 11.5px;
  }
</style>
