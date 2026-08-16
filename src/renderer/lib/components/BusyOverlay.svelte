<script lang="ts">
  /**
   * Busy overlay refreshed per IMPLEMENTATION.md §10.6. A card with a
   * spinner (12px arc rotating around a static ring) + verb-noun
   * headline. Signature unchanged.
   */
  interface Props {
    label: string;
    /** Optional sub-line (e.g. "Rewriting 13 incoming links…"). */
    sub?: string;
  }

  let { label, sub }: Props = $props();
</script>

<div class="overlay" role="status" aria-live="polite">
  <div class="card">
    <div class="spinner" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="32" height="32">
        <circle cx="12" cy="12" r="9" stroke="var(--border)" stroke-width="2" fill="none" />
        <path
          d="M21 12a9 9 0 0 1-9 9"
          stroke="var(--accent)"
          stroke-width="2"
          fill="none"
          stroke-linecap="round"
          class="arc"
        />
      </svg>
    </div>
    <div class="label">{label}</div>
    {#if sub}
      <div class="sub">{sub}</div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-blocking);
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }

  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    padding: 26px 24px 22px;
    width: 300px;
    max-width: 100%;
    text-align: center;
    font-family: var(--font-sans);
    color: var(--text);
  }

  .spinner {
    margin: 0 auto 14px;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .arc {
    transform-origin: 12px 12px;
    animation: spin 1.2s linear infinite;
  }

  .label {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 500;
    letter-spacing: -0.005em;
    color: var(--text);
  }

  .sub {
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
