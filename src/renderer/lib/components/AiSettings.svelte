<script lang="ts">
  /**
   * AI settings panel (default model + Anthropic API key, extracted from
   * SettingsDialog for #672). Per-skill model overrides now live inline in
   * the Skills panel.
   *
   * Unlike the other settings panels, the AI settings are persisted by the
   * dialog's Done handler (so the key + model apply together), not on each
   * edit. So this panel is presentational: the dialog owns the state and the
   * save, and binds it here via `$bindable` props. `apiKeyStatus` is
   * read-only (reflects what's already stored).
   */
  import { MODEL_OPTIONS } from '../../../shared/tools/models';
  import { EFFORT_LEVELS, type Effort } from '../../../shared/tools/effort';
  import type { ApiKeyStorage, ConnectionCheckResult } from '../../../shared/tools/types';
  import { voiceSettings, VOICE_MODEL_OPTIONS } from '../voice/voice-settings.svelte';

  interface Props {
    model: string;
    effort: Effort | undefined;
    apiKeyInput: string;
    clearApiKey: boolean;
    apiKeyStatus: 'unknown' | 'set' | 'unset';
    /** At-rest storage status of the saved key (#1326). Null while loading. */
    keyStorage: ApiKeyStorage | null;
    /** Actively validate a key against Anthropic — the typed value if present,
     *  else the stored one. */
    onCheckConnection: (candidateKey: string) => Promise<ConnectionCheckResult>;
  }

  let {
    model = $bindable(),
    effort = $bindable(),
    apiKeyInput = $bindable(),
    clearApiKey = $bindable(),
    apiKeyStatus,
    keyStorage,
    onCheckConnection,
  }: Props = $props();

  // The saved key is protected at rest only when it's actually encrypted on
  // disk — reflect that literally, don't claim security we don't have.
  const keyEncrypted = $derived(apiKeyStatus === 'set' && !clearApiKey && keyStorage?.encrypted === true);

  // "Check connection" — a presence check (✓ API key saved) doesn't prove
  // Anthropic will accept the key; this fires a real request on demand.
  let checking = $state(false);
  let checkResult = $state<ConnectionCheckResult | null>(null);
  // A stale result must not linger after the key text changes.
  $effect(() => { void apiKeyInput; checkResult = null; });
  // Nothing to check when clearing, or when there's neither a stored key nor a
  // typed one.
  const canCheck = $derived(!clearApiKey && (apiKeyStatus === 'set' || apiKeyInput.trim().length > 0));

  async function runCheck() {
    if (checking) return;
    checking = true;
    checkResult = null;
    try {
      checkResult = await onCheckConnection(apiKeyInput);
    } catch (e) {
      checkResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      checking = false;
    }
  }

  // '' in the <select> means "no override → built-in default"; map to/from
  // the optional `effort` prop.
  function onEffortChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    effort = v ? (v as Effort) : undefined;
  }
</script>

<div class="field">
  <label for="model">Default model</label>
  <select id="model" bind:value={model}>
    {#each MODEL_OPTIONS as m}
      <option value={m.value}>{m.label}</option>
    {/each}
  </select>
</div>
<div class="field">
  <label for="effort">Default reasoning effort</label>
  <select id="effort" value={effort ?? ''} onchange={onEffortChange}>
    <option value="">Model default</option>
    {#each EFFORT_LEVELS as lvl}
      <option value={lvl.value}>{lvl.label}</option>
    {/each}
  </select>
  <p class="hint">
    Higher effort lets the model think longer. Leave on “Model default” to send
    no preference. Per-conversation overrides take precedence. Not all models
    support every level — the per-conversation picker only offers what the chosen
    model accepts (Haiku has no effort control), and “Extra” is Opus-only.
  </p>
</div>
<div class="field">
  <div class="api-key-status" class:saved={apiKeyStatus === 'set' && !clearApiKey}>
    {#if apiKeyStatus === 'unknown'}
      Loading…
    {:else if clearApiKey}
      API key will be cleared on save
    {:else if keyEncrypted}
      🔒 API key saved — encrypted at rest
    {:else if apiKeyStatus === 'set'}
      ✓ API key saved
    {:else}
      No API key set
    {/if}
  </div>
  <label for="api-key">
    Anthropic API key
  </label>
  <input
    id="api-key"
    type="password"
    bind:value={apiKeyInput}
    placeholder={apiKeyStatus === 'set' ? 'Type to replace existing key' : 'Enter Anthropic API key'}
    autocomplete="off"
    spellcheck="false"
    autocapitalize="off"
    oncopy={(e) => e.preventDefault()}
    oncut={(e) => e.preventDefault()}
    oncontextmenu={(e) => e.preventDefault()}
    disabled={clearApiKey}
  />
  <p class="hint">
    {#if keyStorage?.available}
      Your key is encrypted at rest with your operating system's secure storage
      (Keychain on macOS, Credential Manager on Windows, libsecret on Linux).
    {:else if keyStorage}
      No system secure store is available here, so the key is saved as plain text
      in your user data directory.
    {:else}
      The key is stored in your user data directory.
    {/if}
    The saved value is never displayed back. You can also set
    <code>ANTHROPIC_API_KEY</code> as an environment variable.
  </p>
  <div class="check-conn">
    <button class="btn-check" onclick={runCheck} disabled={!canCheck || checking}>
      {checking ? 'Checking…' : 'Check connection'}
    </button>
    {#if checkResult}
      <span class="check-result" class:ok={checkResult.ok} class:bad={!checkResult.ok}>
        {#if checkResult.ok}✓ Connected — Anthropic accepted the key.{:else}✗ {checkResult.error}{/if}
      </span>
    {/if}
  </div>
  {#if apiKeyStatus === 'set' && !clearApiKey}
    <button class="link-btn" onclick={() => { clearApiKey = true; apiKeyInput = ''; }}>
      Clear saved key
    </button>
  {:else if clearApiKey}
    <button class="link-btn" onclick={() => { clearApiKey = false; }}>
      Cancel clear
    </button>
  {/if}
</div>

<!-- Voice/dictation (#voice). Unlike the model/key above (saved by the dialog
     on Done), these are renderer-local prefs persisted immediately to
     localStorage by the voiceSettings store — the transcriber runs entirely in
     the renderer, so main never needs them. -->
<div class="field">
  <label class="checkbox-row">
    <input type="checkbox" bind:checked={voiceSettings.enabled} />
    Enable voice dictation
  </label>
  <p class="hint">
    Shows a microphone in the conversation composer. Speech is transcribed
    on-device with Whisper — your audio never leaves your computer. The model
    (tens of MB) downloads once on first use.
  </p>
</div>
<div class="field" class:disabled={!voiceSettings.enabled}>
  <label for="voice-model">Voice model</label>
  <select id="voice-model" bind:value={voiceSettings.model} disabled={!voiceSettings.enabled}>
    {#each VOICE_MODEL_OPTIONS as m}
      <option value={m.value}>{m.label} — {m.note}</option>
    {/each}
  </select>
</div>

<style>
  /* Shared form vocabulary, scoped to this panel (app's per-dialog convention). */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: 12px;
  }
  .field label { color: var(--text); }
  .field.disabled { opacity: 0.5; }
  .checkbox-row {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .checkbox-row input { cursor: pointer; }
  .field input[type="password"],
  .field select {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .field input[type="password"]:focus,
  .field select:focus {
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
  .link-btn {
    align-self: flex-start;
    margin-top: 4px;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: underline;
    cursor: pointer;
  }
  .link-btn:hover { color: var(--text); }

  /* AI panel — API key status. */
  .api-key-status {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .api-key-status.saved {
    color: var(--accent);
  }

  /* Check-connection row: a small button + an inline result. Success uses
     --sage, failure --rust (signal colors, not red — per CLAUDE.md). */
  .check-conn {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .btn-check {
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button, var(--bg));
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
  }
  .btn-check:hover:not(:disabled) { border-color: var(--accent); }
  .btn-check:disabled { opacity: 0.5; cursor: default; }
  .check-result {
    font-size: 11px;
  }
  .check-result.ok { color: var(--sage); }
  .check-result.bad { color: var(--rust); }
</style>
