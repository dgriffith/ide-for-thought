<script lang="ts">
  /**
   * AI settings panel (BYOM #1498). Multi-provider: a default-model picker
   * grouped by provider, a default reasoning-effort picker, one credential
   * section per provider (API key and/or base URL + a connection check), and a
   * manager for user-defined local models.
   *
   * Presentational: SettingsDialog owns the state (so keys + model apply
   * together on Done) and binds it here. `providerViews` is the read-only
   * loaded status (never carries a plaintext key).
   */
  import { groupedModelOptions } from '../../../shared/tools/models';
  import { EFFORT_LEVELS, type Effort } from '../../../shared/tools/effort';
  import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '../../../shared/tools/providers';
  import type { ProviderConfigView, CustomModel, ConnectionCheckResult } from '../../../shared/tools/types';
  import { voiceSettings, VOICE_MODEL_OPTIONS } from '../voice/voice-settings.svelte';

  /** Per-provider input state (structurally shared with SettingsDialog, which
   *  owns it — kept in sync by shape, not import, to avoid cross-component type
   *  exports). */
  interface ProviderInput {
    /** Unsaved typed key (blank ⇒ keep the stored one). */
    key: string;
    /** Endpoint for providers that use one (local). */
    baseURL: string;
    /** Clear the stored key on save. */
    clear: boolean;
  }

  interface Props {
    model: string;
    effort: Effort | undefined;
    /** Per-provider input state, keyed by provider id. */
    providerInputs: Record<ProviderId, ProviderInput>;
    /** Loaded per-provider status (no plaintext keys). */
    providerViews: Partial<Record<ProviderId, ProviderConfigView>>;
    /** Whether OS secure storage is available (machine-wide) — drives the
     *  "encrypted at rest" claim honestly. */
    secureStorageAvailable: boolean;
    /** User-defined local models. */
    customModels: CustomModel[];
    onCheckConnection: (providerId: ProviderId, candidateKey: string, baseURL: string) => Promise<ConnectionCheckResult>;
  }

  let {
    model = $bindable(),
    effort = $bindable(),
    providerInputs = $bindable(),
    providerViews,
    secureStorageAvailable,
    customModels = $bindable(),
    onCheckConnection,
  }: Props = $props();

  const groups = $derived(groupedModelOptions(customModels));

  function onEffortChange(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    effort = v ? (v as Effort) : undefined;
  }

  // Per-provider "check connection" state.
  const checkState = $state<Record<string, { checking: boolean; result: ConnectionCheckResult | null }>>(
    Object.fromEntries(PROVIDER_IDS.map((id) => [id, { checking: false, result: null }])),
  );

  /** Reassign a provider's input (rather than mutate in place) so the change is
   *  reactive whether the parent bound a `$state` proxy or a plain object. */
  function setInput(id: ProviderId, patch: Partial<{ key: string; baseURL: string; clear: boolean }>) {
    providerInputs = { ...providerInputs, [id]: { ...providerInputs[id], ...patch } };
  }

  function canCheck(id: ProviderId): boolean {
    const meta = PROVIDERS[id];
    const inp = providerInputs[id];
    const view = providerViews[id];
    if (inp.clear) return false;
    if (meta.requiresKey && !(view?.hasApiKey || inp.key.trim())) return false;
    if (meta.usesBaseURL && !(inp.baseURL.trim() || view?.baseURL)) return false;
    return true;
  }

  async function runCheck(id: ProviderId) {
    const st = checkState[id]!;
    if (st.checking) return;
    st.checking = true;
    st.result = null;
    try {
      st.result = await onCheckConnection(id, providerInputs[id].key, providerInputs[id].baseURL);
    } catch (e) {
      st.result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      st.checking = false;
    }
  }

  // A stale check result must not linger after its key/base-URL is edited.
  $effect(() => {
    for (const id of PROVIDER_IDS) {
      void providerInputs[id].key;
      void providerInputs[id].baseURL;
    }
    for (const id of PROVIDER_IDS) checkState[id]!.result = null;
  });

  // Custom (local) model management.
  let newModelId = $state('');
  let newModelLabel = $state('');
  function addCustomModel() {
    const id = newModelId.trim();
    if (!id || customModels.some((m) => m.id === id)) return;
    const label = newModelLabel.trim();
    customModels = [...customModels, { id, ...(label ? { label } : {}) }];
    newModelId = '';
    newModelLabel = '';
  }
  function removeCustomModel(id: string) {
    customModels = customModels.filter((m) => m.id !== id);
  }
</script>

<div class="field">
  <label for="model">Default model</label>
  <select id="model" bind:value={model}>
    {#each groups as g (g.provider)}
      <optgroup label={g.label}>
        {#each g.models as m (m.value)}
          <option value={m.value}>{m.label}</option>
        {/each}
      </optgroup>
    {/each}
  </select>
  <p class="hint">Per-conversation and per-skill pickers can override this.</p>
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
    no preference. Not all models support every level — each provider maps this
    to its own control, and unsupported levels are clamped.
  </p>
</div>

<!-- One credential section per provider. -->
{#each PROVIDER_IDS as id (id)}
  {@const meta = PROVIDERS[id]}
  {@const view = providerViews[id]}
  {@const inp = providerInputs[id]}
  {@const check = checkState[id]}
  <div class="provider-section">
    <div class="provider-head">{meta.label}</div>

    {#if meta.requiresKey}
      <div class="field">
        <div class="api-key-status" class:saved={view?.hasApiKey && !inp.clear}>
          {#if inp.clear}
            API key will be cleared on save
          {:else if view?.hasApiKey && secureStorageAvailable}
            🔒 API key saved — encrypted at rest
          {:else if view?.hasApiKey}
            ✓ API key saved
          {:else}
            No API key set
          {/if}
        </div>
        <input
          type="password"
          bind:value={inp.key}
          placeholder={view?.hasApiKey ? 'Type to replace existing key' : `Enter ${meta.label} API key`}
          autocomplete="off"
          spellcheck="false"
          autocapitalize="off"
          oncopy={(e) => e.preventDefault()}
          oncut={(e) => e.preventDefault()}
          oncontextmenu={(e) => e.preventDefault()}
          disabled={inp.clear}
        />
        {#if view?.hasApiKey && !inp.clear}
          <button class="link-btn" onclick={() => setInput(id, { clear: true, key: '' })}>Clear saved key</button>
        {:else if inp.clear}
          <button class="link-btn" onclick={() => setInput(id, { clear: false })}>Cancel clear</button>
        {/if}
      </div>
    {/if}

    {#if meta.usesBaseURL}
      <div class="field">
        <label for="baseurl-{id}">Base URL</label>
        <input
          id="baseurl-{id}"
          type="text"
          bind:value={inp.baseURL}
          placeholder={meta.defaultBaseURL ?? 'https://…/v1'}
          autocomplete="off"
          spellcheck="false"
          autocapitalize="off"
        />
        <p class="hint">
          Any OpenAI-compatible endpoint — Ollama, LM Studio, vLLM, llama.cpp,
          OpenRouter, Together. Add the models it serves below.
        </p>
      </div>
    {/if}

    <div class="check-conn">
      <button class="btn-check" onclick={() => runCheck(id)} disabled={!canCheck(id) || check?.checking}>
        {check?.checking ? 'Checking…' : 'Check connection'}
      </button>
      {#if check?.result}
        <span class="check-result" class:ok={check.result.ok} class:bad={!check.result.ok}>
          {#if check.result.ok}✓ Connected — {meta.label} accepted it.{:else}✗ {check.result.error}{/if}
        </span>
      {/if}
    </div>

    {#if meta.envVar}
      <p class="hint">You can also set <code>{meta.envVar}</code> as an environment variable.</p>
    {/if}

    {#if id === 'local'}
      <div class="field">
        <span class="pseudo-label">Local models</span>
        {#if customModels.length > 0}
          <ul class="custom-model-list">
            {#each customModels as m (m.id)}
              <li>
                <span class="custom-model-name">{m.label ? `${m.label} · ${m.id}` : m.id}</span>
                <button class="link-btn" onclick={() => removeCustomModel(m.id)}>Remove</button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">No local models added yet.</p>
        {/if}
        <div class="add-model-row">
          <input
            type="text"
            bind:value={newModelId}
            placeholder="Model id (e.g. llama3.1)"
            autocomplete="off"
            spellcheck="false"
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomModel(); } }}
          />
          <input
            type="text"
            bind:value={newModelLabel}
            placeholder="Label (optional)"
            autocomplete="off"
            spellcheck="false"
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomModel(); } }}
          />
          <button class="btn-check" onclick={addCustomModel} disabled={!newModelId.trim()}>Add</button>
        </div>
      </div>
    {/if}
  </div>
{/each}

<div class="field">
  <p class="hint">
    {#if secureStorageAvailable}
      Keys are encrypted at rest with your operating system's secure storage
      (Keychain on macOS, Credential Manager on Windows, libsecret on Linux).
    {:else}
      No system secure store is available here, so keys are saved as plain text
      in your user data directory.
    {/if}
    Saved keys are never displayed back.
  </p>
</div>

<!-- Voice/dictation (#voice). Renderer-local prefs persisted immediately to
     localStorage by the voiceSettings store — the transcriber runs in the
     renderer, so main never needs them. -->
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
  .field label,
  .pseudo-label { color: var(--text); font-size: 12px; }
  .field.disabled { opacity: 0.5; }
  .checkbox-row {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .checkbox-row input { cursor: pointer; }
  .field input[type="password"],
  .field input[type="text"],
  .field select {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .field input:focus,
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

  /* Per-provider credential section. */
  .provider-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
    border-top: 1px solid var(--border);
  }
  .provider-head {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .api-key-status {
    font-size: 11px;
    color: var(--text-muted);
  }
  .api-key-status.saved { color: var(--accent); }

  .custom-model-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .custom-model-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .custom-model-list .link-btn { margin-top: 0; }
  .custom-model-name { font-size: 12px; }
  .add-model-row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .add-model-row input { flex: 1; min-width: 0; }

  /* Check-connection row: a small button + an inline result. Success uses
     --sage, failure --rust (signal colors, not red — per CLAUDE.md). */
  .check-conn {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .btn-check {
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button, var(--bg));
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-check:hover:not(:disabled) { border-color: var(--accent); }
  .btn-check:disabled { opacity: 0.5; cursor: default; }
  .check-result { font-size: 11px; }
  .check-result.ok { color: var(--sage); }
  .check-result.bad { color: var(--rust); }
</style>
