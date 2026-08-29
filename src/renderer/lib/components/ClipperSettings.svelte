<script lang="ts">
  /**
   * Browser-clipper settings panel (#1600, #791) — extracted from SettingsDialog.
   * Enable toggle + pairing code + status. Self-contained: the toggle applies
   * immediately (it starts/stops a loopback server), not on Done.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getSettingsStore } from '../stores/settings.svelte';
  import type { ClipperState } from '../../../shared/clipper-pairing';

  const settings = getSettingsStore();

  let clipper = $state<ClipperState | null>(null);
  let clipperRevealed = $state(false);
  let clipperCopied = $state(false);

  onMount(async () => {
    try {
      clipper = await api.clipper.getState();
    } catch (e) {
      console.error('[settings] failed to load clipper state:', e);
    }
  });

  async function toggleClipper(enabled: boolean) {
    try {
      clipper = await settings.setClipperEnabled(enabled);
      clipperRevealed = false;
      clipperCopied = false;
    } catch (e) {
      console.error('[settings] failed to toggle clipper:', e);
    }
  }

  async function regenerateClipperSecret() {
    try {
      clipper = await settings.regenerateClipperSecret();
      clipperCopied = false;
    } catch (e) {
      console.error('[settings] failed to regenerate clipper secret:', e);
    }
  }

  async function copyPairingCode() {
    if (!clipper?.pairingCode) return;
    try {
      await navigator.clipboard.writeText(clipper.pairingCode);
      clipperCopied = true;
      setTimeout(() => { clipperCopied = false; }, 1500);
    } catch (e) {
      console.error('[settings] failed to copy pairing code:', e);
    }
  }
</script>

<div class="clipper">
      <div class="field checkbox">
        <label>
          <input
            type="checkbox"
            checked={clipper?.enabled ?? false}
            onchange={(e) => toggleClipper(e.currentTarget.checked)}
          />
          Enable browser clipper
        </label>
        <p class="hint">
          Runs a small server on <code>127.0.0.1</code> that the Minerva
          browser extension sends clipped pages to — the page you're reading
          becomes a Source (and your selection a linked excerpt) without a
          copy-paste. Off by default; the endpoint only listens while this is
          on and a thoughtbase is open.
        </p>
      </div>

      {#if clipper?.enabled}
        {#if clipper.running && clipper.pairingCode}
          <div class="field">
            <label for="clipper-pairing">Pairing code</label>
            <div class="clipper-pair-row">
              <input
                id="clipper-pairing"
                class="clipper-pair-code"
                type={clipperRevealed ? 'text' : 'password'}
                readonly
                value={clipper.pairingCode}
              />
              <button class="btn secondary" onclick={() => (clipperRevealed = !clipperRevealed)}>
                {clipperRevealed ? 'Hide' : 'Reveal'}
              </button>
              <button class="btn secondary" onclick={copyPairingCode}>
                {clipperCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p class="hint">
              Paste this into the browser extension once to pair it. Listening
              on port <code>{clipper.port}</code>. Keep it private — anyone
              with the code can send pages to this thoughtbase.
            </p>
          </div>

          <div class="field">
            <button class="btn secondary" onclick={regenerateClipperSecret}>Regenerate code</button>
            <p class="hint">Invalidates the old code; you'll need to re-pair the extension.</p>
          </div>
        {:else}
          <p class="hint">
            Open a thoughtbase to start the clipper and reveal its pairing code.
          </p>
        {/if}
      {/if}

</div>

<style>
  .clipper { display: flex; flex-direction: column; gap: 14px; }
  /* Base .field shape shared via global.css (#1910). */
  .field.checkbox label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .field input[type="checkbox"] {
    cursor: pointer;
  }
  .clipper-pair-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .clipper-pair-code {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: var(--font-mono);
  }
  .clipper-pair-code:focus {
    outline: none;
    border-color: var(--accent);
  }
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint code {
    background: var(--bg-button);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .secondary {
    background: var(--bg-button);
    color: var(--text);
  }
  .secondary:hover {
    background: var(--bg-button-hover);
  }
</style>
