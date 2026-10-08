<script lang="ts">
  /**
   * Floating audio-recording indicator (#2428).
   *
   * A recording is started from the palette, File menu or editor menu, so it
   * has no anchored button of its own. This pill shows the elapsed time with
   * Stop / Cancel while recording, segment progress while a recording is
   * being transcribed, and any error. It sits where the dictation pill does;
   * the two can't both be recording, since a recording refuses to start while
   * dictation is busy.
   */
  import Icon from './Icon.svelte';
  import { getAudioRecordingStore } from '../voice/audio-recording.svelte';
  import { getVoiceStore } from '../voice/voice.svelte';
  import { formatElapsed } from '../voice/recording-text';

  const rec = getAudioRecordingStore();
  const voice = getVoiceStore();

  const visible = $derived(rec.status !== 'idle' || !!rec.transcription || !!rec.error);


  function onKeydown(e: KeyboardEvent) {
    if (!visible || e.key !== 'Escape') return;
    if (rec.error) {
      e.preventDefault();
      rec.clearError();
    } else if (rec.recording) {
      e.preventDefault();
      rec.cancel();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if visible}
  <div class="recording-pill" role="status" aria-live="polite">
    {#if rec.error}
      <Icon name="warn" size={13} />
      <span class="label">{rec.error}</span>
      <button class="pill-btn" onclick={() => rec.clearError()}>Dismiss</button>
    {:else if rec.status === 'starting'}
      <span class="dot pulse"></span>
      <span class="label">Starting recording…</span>
    {:else if rec.recording}
      <span class="dot pulse"></span>
      <span class="label">Recording</span>
      <span class="time">{formatElapsed(rec.elapsedSec)}</span>
      <span class="hint">esc cancel</span>
      <button class="pill-btn primary" onclick={() => void rec.stop()}>Stop</button>
      <button class="pill-btn" onclick={() => rec.cancel()}>Cancel</button>
    {:else if rec.status === 'saving'}
      <span class="dot pulse"></span>
      <span class="label">Saving recording…</span>
    {:else if rec.transcription}
      <span class="dot pulse"></span>
      {#if voice.modelProgress}
        <span class="label">{voice.modelProgress}</span>
      {:else if rec.transcription.total > 1}
        <span class="label">Transcribing… {rec.transcription.done} of {rec.transcription.total}</span>
      {:else}
        <span class="label">Transcribing…</span>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .recording-pill {
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
  .time {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
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
  .dot.pulse { animation: rec-pulse 1.4s ease-in-out infinite; }
  @keyframes rec-pulse {
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
