<script lang="ts">
  /**
   * AI settings panel (default model + Anthropic API key + per-tool model
   * overrides, extracted from SettingsDialog for #672).
   *
   * Unlike the other settings panels, the AI settings are persisted by the
   * dialog's Done handler (so the key + model + overrides apply together), not
   * on each edit. So this panel is presentational: the dialog owns the state
   * and the save, and binds it here via `$bindable` props. `apiKeyStatus` is
   * read-only (reflects what's already stored).
   */
  import { MODEL_OPTIONS, modelLabel } from '../../../shared/tools/models';
  import { getAllToolInfos } from '../tools/tool-registry';
  import type { ThinkingToolInfo } from '../../../shared/tools/types';

  interface Props {
    model: string;
    apiKeyInput: string;
    clearApiKey: boolean;
    toolModelOverrides: Record<string, string>;
    apiKeyStatus: 'unknown' | 'set' | 'unset';
  }

  let {
    model = $bindable(),
    apiKeyInput = $bindable(),
    clearApiKey = $bindable(),
    toolModelOverrides = $bindable(),
    apiKeyStatus,
  }: Props = $props();

  const allTools: ThinkingToolInfo[] = getAllToolInfos();

  function setToolOverride(toolId: string, value: string): void {
    const next = { ...toolModelOverrides };
    if (value) next[toolId] = value;
    else delete next[toolId];
    toolModelOverrides = next;
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
<div class="field">
  <span class="field-label">Tool model overrides</span>
  <p class="hint">
    Each tool's author may suggest a preferred model. You can override that
    per tool. Empty override → use the tool's preference; no preference →
    fall back to the default model above.
  </p>
  {#if allTools.length === 0}
    <p class="hint">No tools registered.</p>
  {:else}
    <table class="tool-models">
      <thead>
        <tr>
          <th>Tool</th>
          <th>Tool preference</th>
          <th>Your override</th>
        </tr>
      </thead>
      <tbody>
        {#each allTools as t}
          <tr>
            <td>{t.name}</td>
            <td class="muted">{t.preferredModel ? modelLabel(t.preferredModel) : '—'}</td>
            <td>
              <select
                value={toolModelOverrides[t.id] ?? ''}
                onchange={(e) => setToolOverride(t.id, e.currentTarget.value)}
              >
                <option value="">Use tool preference</option>
                {#each MODEL_OPTIONS as m}
                  <option value={m.value}>{m.label}</option>
                {/each}
              </select>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
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

  /* AI panel — API key status + tool-override table. */
  .api-key-status {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .api-key-status.saved {
    color: var(--accent);
  }
  .tool-models {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .tool-models th,
  .tool-models td {
    text-align: left;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
  }
  .tool-models th {
    font-weight: 600;
    color: var(--text-muted);
    font-size: 11px;
  }
  .tool-models td.muted {
    color: var(--text-muted);
  }
  .tool-models select {
    padding: 3px 6px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    max-width: 170px;
  }
</style>
