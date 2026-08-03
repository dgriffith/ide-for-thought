<script lang="ts">
  /**
   * Web-access settings panel (#1600) — extracted from SettingsDialog. Enable
   * flag + allow/block domain lists. Done-batched: the parent owns the state
   * (bound here) and folds it into the LLMSettingsUpdate saved in handleDone.
   */
  let {
    webEnabled = $bindable(),
    allowedDomainsText = $bindable(),
    blockedDomainsText = $bindable(),
  }: { webEnabled: boolean; allowedDomainsText: string; blockedDomainsText: string } = $props();
</script>

<div class="web-settings">
      <div class="field checkbox">
        <label>
          <input type="checkbox" bind:checked={webEnabled} />
          Enable web access for conversations
        </label>
        <p class="hint">
          When off, the assistant cannot call <code>web_search</code> or <code>web_fetch</code>.
        </p>
      </div>
      <div class="field" class:disabled={!webEnabled}>
        <label for="allowed-domains">Allowed domains</label>
        <textarea
          id="allowed-domains"
          rows="3"
          bind:value={allowedDomainsText}
          disabled={!webEnabled}
          placeholder="One domain per line (e.g. arxiv.org)"
        ></textarea>
        <p class="hint">
          If any domains are listed, web searches are restricted to them.
          Leave blank to search the whole web.
        </p>
      </div>
      <div class="field" class:disabled={!webEnabled}>
        <label for="blocked-domains">Blocked domains</label>
        <textarea
          id="blocked-domains"
          rows="3"
          bind:value={blockedDomainsText}
          disabled={!webEnabled}
          placeholder="One domain per line"
        ></textarea>
        <p class="hint">
          Ignored when an allowlist is set. The API accepts one or the other.
        </p>
      </div>

</div>

<style>
  .web-settings { display: flex; flex-direction: column; gap: 14px; }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text);
    font-size: 12px;
  }
  .field label {
    color: var(--text);
  }
  .field.checkbox label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .field input[type="checkbox"] {
    cursor: pointer;
  }
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .field.disabled label,
  .field.disabled .hint {
    opacity: 0.5;
  }
  .field textarea {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    resize: vertical;
    min-height: 60px;
  }
  .field textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .hint code {
    background: var(--bg-button);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }
</style>
