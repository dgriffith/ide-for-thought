<script lang="ts">
  import { getToolPanelStore } from '../stores/tool-panel.svelte';
  import { handleToolOutput } from '../tools/output';
  import { api } from '../ipc/client';

  interface Props {
    onNoteCreated?: () => void;
  }

  let { onNoteCreated }: Props = $props();

  const panel = getToolPanelStore();
  let paramValues = $state<Record<string, string>>({});
  let running = $state(false);

  $effect(() => {
    if (panel.panelState === 'configure') {
      const params = panel.activeTool?.parameters;
      if (!params) return;
      const values: Record<string, string> = {};
      for (const p of params) {
        values[p.id] = p.defaultValue ?? '';
      }
      paramValues = values;
    }
  });

  async function executeToolRun() {
    const tool = panel.activeTool;
    if (!tool || running) return;
    running = true;

    try {
      const result = await api.tools.execute({
        toolId: tool.id,
        context: $state.snapshot(panel.context),
      });
      panel.complete(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      panel.fail(message);
    } finally {
      running = false;
    }
  }

  function handleRunWithParams() {
    if (Object.keys(paramValues).length > 0) {
      panel.startRunning($state.snapshot(paramValues));
    } else {
      panel.startRunning();
    }
    executeToolRun();
  }

  async function handleCancel() {
    await api.tools.cancel();
    panel.fail('Cancelled');
    running = false;
  }

  async function handleSaveAsNote() {
    if (!panel.result) return;
    await handleToolOutput(panel.result, 'newNote', $state.snapshot(panel.context));
    onNoteCreated?.();
    panel.close();
  }

  async function handleAppend() {
    if (!panel.result) return;
    await handleToolOutput(panel.result, 'appendToNote', $state.snapshot(panel.context));
    panel.close();
  }

  function handleCopyToClipboard() {
    const text = panel.result?.output ?? panel.streamedOutput;
    if (text) navigator.clipboard.writeText(text);
  }

  // Called externally when panel opens in 'running' state (no params)
  export function startExecution() {
    panel.startRunning();
    executeToolRun();
  }
</script>

{#if panel.panelState !== 'hidden'}
  <div class="tool-panel">
    <div class="tool-header">
      <div class="tool-title">
        <span class="tool-name">{panel.activeTool?.name ?? 'Tool'}</span>
        <span class="tool-desc">{panel.activeTool?.description ?? ''}</span>
      </div>
      <button class="close-btn" onclick={() => { panel.close(); running = false; }}>&#x2715;</button>
    </div>

    {#if panel.panelState === 'configure'}
      <div class="tool-body">
        <div class="tool-info">{panel.activeTool?.longDescription ?? ''}</div>
        {#if panel.activeTool?.parameters}
          <div class="params">
            {#each panel.activeTool.parameters as param}
              <label class="param-label">
                <span>{param.label}{param.required ? ' *' : ''}</span>
                {#if param.type === 'select' && param.options}
                  <select bind:value={paramValues[param.id]}>
                    {#each param.options as opt}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                {:else if param.type === 'textarea'}
                  <textarea
                    bind:value={paramValues[param.id]}
                    placeholder={param.placeholder ?? ''}
                    rows="3"
                  ></textarea>
                {:else}
                  <input
                    type={param.type === 'number' ? 'number' : 'text'}
                    bind:value={paramValues[param.id]}
                    placeholder={param.placeholder ?? ''}
                  />
                {/if}
              </label>
            {/each}
          </div>
        {/if}
        {#if panel.context.selectedText}
          <div class="context-preview">
            <span class="context-label">Selected text ({panel.context.selectedText.length} chars)</span>
          </div>
        {:else if panel.context.fullNoteContent}
          <div class="context-preview">
            <span class="context-label">Full note: {panel.context.fullNoteTitle ?? 'Untitled'}</span>
          </div>
        {/if}
        <div class="actions">
          <button class="btn primary" onclick={handleRunWithParams}>Run</button>
          <button class="btn" onclick={() => panel.close()}>Cancel</button>
        </div>
      </div>

    {:else if panel.panelState === 'running'}
      <div class="tool-body output-body">
        <div class="output-scroll">
          <pre class="output">{panel.streamedOutput || 'Thinking...'}</pre>
        </div>
        <div class="actions">
          <button class="btn" onclick={handleCancel}>Cancel</button>
        </div>
      </div>

    {:else if panel.panelState === 'review'}
      <div class="tool-body output-body">
        {#if panel.error}
          <div class="error-msg">{panel.error}</div>
        {:else}
          <div class="output-scroll">
            <pre class="output">{panel.result?.output ?? panel.streamedOutput}</pre>
          </div>
        {/if}
        <div class="actions">
          {#if !panel.error}
            <button class="btn primary" onclick={handleSaveAsNote}>Save as Note</button>
            <button class="btn" onclick={handleAppend}>Append to Current</button>
            <button class="btn" onclick={handleCopyToClipboard}>Copy</button>
          {/if}
          <button class="btn" onclick={() => panel.close()}>
            {panel.error ? 'Close' : 'Discard'}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tool-panel {
    border-top: 1px solid var(--border);
    background: var(--bg-sidebar);
    display: flex;
    flex-direction: column;
    max-height: 50%;
    min-height: 120px;
  }

  .tool-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .tool-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .tool-name {
    font-weight: 600;
    font-size: 13px;
    color: var(--titlebar-text);
  }

  .tool-desc {
    font-size: 12px;
    color: var(--titlebar-text-muted);
  }

  .close-btn {
    padding: 2px 6px;
    border: none;
    border-radius: 3px;
    background: none;
    color: var(--titlebar-text-muted);
    cursor: pointer;
    font-size: 12px;
  }

  .close-btn:hover {
    background: var(--titlebar-button);
    color: var(--titlebar-text);
  }

  .tool-body {
    padding: 12px;
    overflow-y: auto;
    flex: 1;
  }

  .output-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tool-info {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 12px;
    line-height: 1.5;
  }

  .params {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }

  .param-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text);
  }

  .param-label input,
  .param-label textarea,
  .param-label select {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    font-family: inherit;
  }

  .param-label input:focus,
  .param-label textarea:focus,
  .param-label select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .context-preview {
    margin-bottom: 12px;
  }

  .context-label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .output-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 60px;
  }

  .output {
    font-size: 12px;
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
    margin: 0;
    font-family: inherit;
  }

  .error-msg {
    padding: 8px 12px;
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    padding-top: 8px;
  }

  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }

  .btn:hover {
    background: var(--bg-button-hover);
  }

  .btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }

  .btn.primary:hover {
    opacity: 0.9;
  }
</style>
