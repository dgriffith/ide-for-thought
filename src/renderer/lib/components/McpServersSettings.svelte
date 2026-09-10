<script lang="ts">
  /**
   * MCP Servers settings panel (#2031). Self-contained, modeled on
   * SkillsSettings.svelte: loads the server list on mount (a read — direct
   * `api.mcpServers.list()`, per the renderer data-flow rule) and drives
   * every mutation through `getSettingsStore()`.
   *
   * A server's live connection state (status, tools) is never owned locally
   * beyond what the last `list()`/mutation response returned — there's no
   * change-event subscription here, since nothing outside this panel changes
   * server config, and the app's one background mutator (the startup
   * auto-connect in `main.ts`) has already settled by the time a user opens
   * Settings.
   */
  import { onMount } from 'svelte';
  import { api } from '../ipc/client';
  import { getSettingsStore } from '../stores/settings.svelte';
  import type { McpServerDescriptor, McpServerStatus, McpServerConnectionStatus } from '../../../shared/mcp-servers';

  const settings = getSettingsStore();

  let servers = $state<McpServerStatus[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);

  let formOpen = $state(false);
  let editingId = $state<string | null>(null);
  let formKind = $state<McpServerDescriptor['kind']>('stdio');
  let formName = $state('');
  let formCommand = $state('');
  let formArgs = $state('');
  let formEnv = $state('');
  let formUrl = $state('');

  function statusLabel(status: McpServerConnectionStatus): string {
    switch (status) {
      case 'connected': return '● Connected';
      case 'connecting': return '… Connecting';
      case 'needs-auth': return '⚠ Needs authorization';
      case 'error': return '✕ Error';
      default: return '○ Disconnected';
    }
  }

  function parseArgs(text: string): string[] {
    return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  }

  function parseEnv(text: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
  }

  function formatArgs(args: string[] | undefined): string {
    return (args ?? []).join('\n');
  }

  function formatEnv(env: Record<string, string> | undefined): string {
    return Object.entries(env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
  }

  function resetForm(): void {
    formKind = 'stdio';
    formName = '';
    formCommand = '';
    formArgs = '';
    formEnv = '';
    formUrl = '';
  }

  function openAddForm(): void {
    error = null;
    editingId = null;
    resetForm();
    formOpen = true;
  }

  function openEditForm(s: McpServerStatus): void {
    error = null;
    editingId = s.id;
    formName = s.name;
    formKind = s.descriptor.kind;
    if (s.descriptor.kind === 'stdio') {
      formCommand = s.descriptor.command;
      formArgs = formatArgs(s.descriptor.args);
      formEnv = formatEnv(s.descriptor.env);
      formUrl = '';
    } else {
      formUrl = s.descriptor.url;
      formCommand = '';
      formArgs = '';
      formEnv = '';
    }
    formOpen = true;
  }

  function closeForm(): void {
    formOpen = false;
    editingId = null;
  }

  function buildDescriptor(): McpServerDescriptor | null {
    if (formKind === 'stdio') {
      const command = formCommand.trim();
      if (!command) return null;
      const descriptor: Extract<McpServerDescriptor, { kind: 'stdio' }> = { kind: 'stdio', command };
      const args = parseArgs(formArgs);
      if (args.length > 0) descriptor.args = args;
      const env = parseEnv(formEnv);
      if (Object.keys(env).length > 0) descriptor.env = env;
      return descriptor;
    }
    const url = formUrl.trim();
    return url ? { kind: 'http', url } : null;
  }

  async function loadServers(): Promise<void> {
    servers = await api.mcpServers.list();
  }

  async function submitForm(): Promise<void> {
    const name = formName.trim();
    const descriptor = buildDescriptor();
    if (!name || !descriptor) {
      error = 'Name and ' + (formKind === 'stdio' ? 'command' : 'URL') + ' are required.';
      return;
    }
    error = null;
    busy = true;
    try {
      if (editingId) await settings.updateMcpServer(editingId, { name, descriptor });
      else await settings.addMcpServer(name, descriptor);
      await loadServers();
      closeForm();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function removeServerRow(id: string): Promise<void> {
    error = null;
    busy = true;
    try {
      await settings.removeMcpServer(id);
      await loadServers();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function toggleEnabled(id: string, enabled: boolean): Promise<void> {
    error = null;
    busy = true;
    try {
      await settings.setMcpServerEnabled(id, enabled);
      await loadServers();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function connectRow(id: string): Promise<void> {
    error = null;
    busy = true;
    try {
      await settings.connectMcpServer(id);
      await loadServers();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  onMount(loadServers);
</script>

<div class="field">
  <span class="field-label">MCP Servers</span>
  <p class="hint">
    Connect external tool servers that speak the Model Context Protocol —
    a local command (stdio) or a remote URL, which may require authorizing
    in your browser. Enabling a server keeps it connected across restarts.
  </p>
  <div class="mcp-actions">
    <button class="action-btn" onclick={openAddForm} disabled={busy}>
      Add server…
    </button>
  </div>
</div>

{#if error}
  <div class="mcp-error">{error}</div>
{/if}

{#if formOpen}
  <div class="field mcp-form">
    <span class="field-label">{editingId ? 'Edit server' : 'New server'}</span>
    <label class="mcp-form-field">
      <span>Name</span>
      <input type="text" bind:value={formName} placeholder="My server" />
    </label>
    <div class="mcp-kind-row">
      <label>
        <input type="radio" name="mcp-kind" value="stdio" bind:group={formKind} />
        Local command (stdio)
      </label>
      <label>
        <input type="radio" name="mcp-kind" value="http" bind:group={formKind} />
        Remote URL
      </label>
    </div>
    {#if formKind === 'stdio'}
      <label class="mcp-form-field">
        <span>Command</span>
        <input type="text" bind:value={formCommand} placeholder="npx" />
      </label>
      <label class="mcp-form-field">
        <span>Arguments (one per line)</span>
        <textarea bind:value={formArgs} rows="3" placeholder={'-y\n@modelcontextprotocol/server-everything'}></textarea>
      </label>
      <label class="mcp-form-field">
        <span>Environment (KEY=VALUE, one per line)</span>
        <textarea bind:value={formEnv} rows="2"></textarea>
      </label>
    {:else}
      <label class="mcp-form-field">
        <span>URL</span>
        <input type="text" bind:value={formUrl} placeholder="https://example.com/mcp" />
      </label>
    {/if}
    <div class="mcp-actions">
      <button class="action-btn" onclick={() => { void submitForm(); }} disabled={busy}>
        {editingId ? 'Save' : 'Add'}
      </button>
      <button class="action-btn" onclick={closeForm} disabled={busy}>Cancel</button>
    </div>
  </div>
{/if}

<div class="field">
  {#if servers.length === 0}
    <p class="hint empty">No MCP servers configured yet.</p>
  {:else}
    <ul class="mcp-list">
      {#each servers as s (s.id)}
        <li class:disabled={!s.enabled}>
          <div class="mcp-row">
            <input
              type="checkbox"
              class="mcp-toggle"
              checked={s.enabled}
              title={s.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
              disabled={busy}
              onchange={(e) => { void toggleEnabled(s.id, e.currentTarget.checked); }}
            />
            <span class="mcp-name">{s.name}</span>
            <span class="mcp-kind">{s.descriptor.kind}</span>
            <span class="mcp-status">{statusLabel(s.status)}</span>
            <div class="mcp-controls">
              {#if s.enabled && s.status !== 'connected' && s.status !== 'connecting'}
                <button class="link-btn" onclick={() => { void connectRow(s.id); }} disabled={busy}>Connect</button>
              {/if}
              <button class="link-btn" onclick={() => openEditForm(s)} disabled={busy}>Edit</button>
              <button class="link-btn" onclick={() => { void removeServerRow(s.id); }} disabled={busy}>Remove</button>
            </div>
          </div>
          {#if s.error}
            <span class="mcp-desc mcp-row-error">{s.error}</span>
          {/if}
          {#if s.status === 'connected'}
            <details class="mcp-tools">
              <summary>{s.tools.length} {s.tools.length === 1 ? 'tool' : 'tools'}</summary>
              <ul>
                {#each s.tools as tool (tool.name)}
                  <li><span class="mcp-tool-name">{tool.name}</span>{#if tool.description} — {tool.description}{/if}</li>
                {/each}
              </ul>
            </details>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Shared form vocabulary, scoped to this panel (app's per-dialog
     convention). The base .field shape (including its `color`, which
     `.field-label` would just redundantly repeat since `color` inherits)
     lives in global.css (#1910). */
  .hint {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint.empty {
    font-style: italic;
    margin: 0 0 8px 0;
  }
  .action-btn {
    align-self: flex-start;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .action-btn:hover:not(:disabled) { background: var(--bg-button-hover); }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: underline;
    cursor: pointer;
  }
  .link-btn:hover:not(:disabled) { color: var(--text); }
  .link-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .mcp-error {
    margin-top: 8px;
    padding: 6px 10px;
    border-left: 3px solid var(--accent);
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    white-space: pre-wrap;
  }
  .mcp-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .mcp-form {
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-button);
    border-radius: 4px;
  }
  .mcp-form-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--text);
  }
  .mcp-form-field input,
  .mcp-form-field textarea {
    padding: 5px 8px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
  }
  .mcp-form-field textarea {
    font-family: var(--font-mono, ui-monospace, monospace);
    resize: vertical;
  }
  .mcp-kind-row {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--text);
  }
  .mcp-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mcp-list li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    background: var(--bg-button);
    border-radius: 4px;
  }
  .mcp-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mcp-list li.disabled .mcp-name {
    opacity: 0.45;
  }
  .mcp-toggle {
    flex: none;
    margin: 0;
    cursor: pointer;
  }
  .mcp-name {
    font-weight: 600;
    font-size: 13px;
  }
  .mcp-kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted, var(--text));
    opacity: 0.6;
  }
  .mcp-status {
    font-size: 11px;
    color: var(--text-muted, var(--text));
  }
  .mcp-controls {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .mcp-desc {
    font-size: 12px;
    color: var(--text-muted, var(--text));
    opacity: 0.8;
  }
  .mcp-row-error {
    opacity: 1;
    color: var(--accent);
  }
  .mcp-tools {
    font-size: 12px;
    color: var(--text-muted, var(--text));
  }
  .mcp-tools ul {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .mcp-tool-name {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--text);
  }
</style>
