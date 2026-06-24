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

  interface Props {
    model: string;
    effort: Effort | undefined;
    apiKeyInput: string;
    clearApiKey: boolean;
    apiKeyStatus: 'unknown' | 'set' | 'unset';
  }

  let {
    model = $bindable(),
    effort = $bindable(),
    apiKeyInput = $bindable(),
    clearApiKey = $bindable(),
    apiKeyStatus,
  }: Props = $props();

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
    Keys are stored in your user data directory. The saved value is never displayed back.
    You can also set <code>ANTHROPIC_API_KEY</code> as an environment variable.
  </p>
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
</style>
