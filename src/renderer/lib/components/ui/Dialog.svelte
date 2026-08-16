<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';

  interface Props {
    /** Card width in px. Spec defaults: confirm 440, prompt 460, palette 640. */
    width?: number;
    /** Click on the backdrop / Escape key. Both are routed here. */
    onClose?: () => void;
    /** Optional aria-labelledby — typically the eyebrow + title elements id'd
     *  by the caller. When omitted we set role="dialog" with no label. */
    'aria-labelledby'?: string;
    /** Header eyebrow (mono-uppercase). */
    eyebrow?: Snippet;
    /** Header title (display-serif H1). */
    title?: Snippet;
    /** Main body content. */
    body?: Snippet;
    /** Footer left slot — kbd hints. */
    footerLeft?: Snippet;
    /** Footer right slot — buttons (Cancel · primary CTA). */
    footerRight?: Snippet;
  }

  let {
    width = 440,
    onClose,
    'aria-labelledby': ariaLabelledBy,
    eyebrow,
    title,
    body,
    footerLeft,
    footerRight,
  }: Props = $props();

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose?.();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose?.();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onclick={onBackdropClick}
>
  <div
    class="card"
    role="dialog"
    aria-modal="true"
    aria-labelledby={ariaLabelledBy}
    style:width="{width}px"
  >
    {#if eyebrow || title}
      <header class="card-header">
        {#if eyebrow}<div class="eyebrow">{@render eyebrow()}</div>{/if}
        {#if title}<h2 class="title">{@render title()}</h2>{/if}
      </header>
    {/if}

    {#if body}
      <div class="card-body">{@render body()}</div>
    {/if}

    {#if footerLeft || footerRight}
      <footer class="card-footer">
        <div class="footer-left">
          {#if footerLeft}{@render footerLeft()}{/if}
        </div>
        <div class="footer-right">
          {#if footerRight}{@render footerRight()}{/if}
        </div>
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    background: var(--scrim-bg);
    backdrop-filter: var(--scrim-blur);
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    max-width: 100%;
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }
  .card-header {
    padding: 20px 24px 0;
  }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .title {
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -0.005em;
    margin: 0;
  }
  .card-body {
    padding: 14px 24px 18px;
    overflow: auto;
    flex: 1;
    font-size: 13px;
    line-height: 1.5;
  }
  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .footer-left {
    margin-right: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .footer-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
