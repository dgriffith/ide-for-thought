<script lang="ts">
  /**
   * Floating dictation indicator (#voice, Phase 2).
   *
   * The composer mic has its own inline affordance; dictation into the editor
   * has no anchored button, so this global pill gives the recording/transcribe
   * feedback and the stop/cancel controls. It only appears for the `editor`
   * surface — composer dictation is shown in the composer footer.
   */
  import Icon from './Icon.svelte';
  import { getVoiceStore } from '../voice/voice.svelte';
  import { toggleEditorDictation, cancelEditorDictation } from '../editor/dictation';

  const voice = getVoiceStore();

  const mine = $derived(voice.surface === 'editor');
  const visible = $derived(
    mine && (voice.recording || voice.status === 'transcribing' || !!voice.modelProgress || !!voice.error),
  );

  function onKeydown(e: KeyboardEvent) {
    if (!visible) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (voice.error) voice.clearError();
      else cancelEditorDictation();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if visible}
  <div class="dictation-pill" role="status" aria-live="polite">
    {#if voice.error}
      <Icon name="warn" size={13} />
      <span class="label">{voice.error}</span>
      <button class="pill-btn" onclick={() => voice.clearError()}>Dismiss</button>
    {:else if voice.modelProgress}
      <span class="dot pulse"></span>
      <span class="label">{voice.modelProgress}</span>
    {:else if voice.status === 'transcribing'}
      <span class="dot pulse"></span>
      <span class="label">Transcribing…</span>
    {:else}
      <span class="dot pulse"></span>
      <span class="label">Listening<span class="ell">…</span></span>
      <span class="hint">⌘⇧V insert · esc cancel</span>
      <button class="pill-btn primary" onclick={() => void toggleEditorDictation(null)}>Insert</button>
      <button class="pill-btn" onclick={() => cancelEditorDictation()}>Cancel</button>
    {/if}
  </div>
{/if}

<style>
  .dictation-pill {
    position: fixed;
    left: 50%;
    bottom: 44px;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elevated, var(--bg-button));
    color: var(--text);
    font-size: 12px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  }
  .label { font-weight: 500; }
  .hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  /* Recording marker — accent, not red, per the house rules. */
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .dot.pulse { animation: pill-pulse 1.4s ease-in-out infinite; }
  @keyframes pill-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .pill-btn {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
  }
  .pill-btn:hover { color: var(--text); border-color: var(--text-muted); }
  .pill-btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
    font-weight: 600;
  }
  .pill-btn.primary:hover { opacity: 0.9; color: var(--accent-ink); }
</style>
