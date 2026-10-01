<script lang="ts">
  import { formatElapsed, verbAt, verbOffsetFor } from '../../conversations/turn-status';

  interface Props {
    /** When the in-flight turn started (epoch ms); null shows the dots alone. */
    startedAt: number | null;
  }

  let { startedAt }: Props = $props();

  let now = $state(Date.now());

  // A one-second clock, only while mounted (the indicator exists only while a
  // turn is in flight).
  $effect(() => {
    now = Date.now();
    const id = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(id);
  });

  const elapsed = $derived(startedAt === null ? 0 : now - startedAt);
  const verb = $derived(startedAt === null ? 'Thinking' : verbAt(elapsed, verbOffsetFor(startedAt)));
</script>

<!-- role="status" is a live region: the ticking text inside is aria-hidden so
     a screen reader isn't read a new number every second. Turn start/finish
     are announced separately (#2374). -->
<div class="thinking-indicator" aria-label="Thinking" role="status">
  <span class="thinking-dot"></span>
  <span class="thinking-dot"></span>
  <span class="thinking-dot"></span>
  {#if startedAt !== null}
    <span class="turn-status-text" aria-hidden="true">
      <span class="turn-verb">{verb}…</span>
      <span class="turn-elapsed">{formatElapsed(elapsed)}</span>
    </span>
  {/if}
</div>

<style>
  /* Three dots that pulse out of phase, then what it's doing and for how long. */
  .thinking-indicator {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 0;
  }
  .thinking-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.35;
    animation: thinking-pulse 1.2s ease-in-out infinite;
  }
  .thinking-dot:nth-child(2) { animation-delay: 0.18s; }
  .thinking-dot:nth-child(3) { animation-delay: 0.36s; }
  @keyframes thinking-pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
    40%          { opacity: 1;    transform: scale(1.1); }
  }
  .turn-status-text {
    display: inline-flex;
    gap: 8px;
    margin-left: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .turn-elapsed {
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .thinking-dot { animation: none; opacity: 0.6; }
  }
</style>
