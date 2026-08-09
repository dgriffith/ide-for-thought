<script lang="ts">
  import { getToolPanelStore } from '../stores/tool-panel.svelte';
  import { handleToolOutput } from '../tools/output';
  import { api } from '../ipc/client';
  import Icon from './Icon.svelte';
  import ToolParamsDialog from './ToolParamsDialog.svelte';
  import type { ToolContext } from '../../../shared/tools/types';
  import { isProviderUnconfiguredError } from '../../../shared/llm-errors';
  import { resolveNoteParams } from '../tools/resolve-note-params';

  interface Props {
    onNoteCreated?: () => void;
    /** Called when the user invokes a tool whose outputMode is `openConversation`. */
    onOpenConversation?: (invocation: { toolId: string; context: ToolContext }) => void;
    /** Called when a tool execution fails because no Anthropic API key
     *  is configured. App-level handler shows an actionable Open
     *  Settings dialog; without this hook the user would only see
     *  "Anthropic API key not configured…" as the tool's failure
     *  string with no path to fix it. */
    onMissingApiKey?: () => void;
  }

  let { onNoteCreated, onOpenConversation, onMissingApiKey }: Props = $props();

  const panel = getToolPanelStore();
  let running = $state(false);

  async function executeToolRun() {
    const tool = panel.activeTool;
    if (!tool || running) return;
    running = true;

    try {
      const result = await panel.executeTool({
        toolId: tool.id,
        context: $state.snapshot(panel.context),
      });
      panel.complete(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isProviderUnconfiguredError(err)) {
        // Close the tool panel and let the App-level handler surface
        // the Open-Settings dialog. The panel's inline error string
        // still mentioned the missing key, but with no actionable
        // path; punting up to the App keeps the user inside one
        // canonical "configure your key" flow.
        panel.close();
        onMissingApiKey?.();
      } else {
        panel.fail(message);
      }
    } finally {
      running = false;
    }
  }

  async function handleRunWithParams(rawValues: Record<string, string>) {
    const tool = panel.activeTool;
    if (!tool) return;

    // Resolve any note-picker params to the picked note's content/title before
    // folding them in (#516), so the prompt can reference {{param.x.content}}.
    const snappedParams = Object.keys(rawValues).length > 0
      ? await resolveNoteParams(tool.parameters, rawValues, (p) => api.notebase.readFile(p))
      : undefined;

    if (tool.outputMode === 'openConversation') {
      // Fold parameter values into the context and hand off to the
      // conversation launcher. No in-panel execution or review.
      const ctx: ToolContext = {
        ...$state.snapshot(panel.context),
        ...(snappedParams ? { parameterValues: snappedParams } : {}),
      };
      if (tool.requiresSelection && !ctx.selectedText?.trim()) {
        panel.fail(`${tool.name} needs a text selection. Highlight some text in the editor and try again.`);
        return;
      }
      panel.close();
      onOpenConversation?.({ toolId: tool.id, context: ctx });
      return;
    }

    if (snappedParams) {
      panel.startRunning(snappedParams);
    } else {
      panel.startRunning();
    }
    void executeToolRun();
  }

  async function handleCancel() {
    await panel.cancelTool();
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
    if (text) void navigator.clipboard.writeText(text);
  }

  // Called externally when panel opens in 'running' state (no params)
  export function startExecution() {
    const tool = panel.activeTool;
    if (!tool) return;

    if (tool.outputMode === 'openConversation') {
      const ctx: ToolContext = $state.snapshot(panel.context);
      if (tool.requiresSelection && !ctx.selectedText?.trim()) {
        panel.fail(`${tool.name} needs a text selection. Highlight some text in the editor and try again.`);
        return;
      }
      panel.close();
      onOpenConversation?.({ toolId: tool.id, context: ctx });
      return;
    }

    panel.startRunning();
    void executeToolRun();
  }
</script>

<!-- Argument entry is a dismissable modal (#: tool-args UX); streaming + review
     stay in the bottom dock below, where output is read alongside the note. -->
{#if panel.panelState === 'configure' && panel.activeTool}
  <ToolParamsDialog
    tool={panel.activeTool}
    context={panel.context}
    onRun={(values) => { void handleRunWithParams(values); }}
    onCancel={() => panel.close()}
  />
{/if}

{#if panel.panelState === 'running' || panel.panelState === 'review'}
  <div class="tool-panel">
    <div class="tool-header">
      <div class="tool-title">
        <span class="tool-name">{panel.activeTool?.name ?? 'Tool'}</span>
        <span class="tool-desc">{panel.activeTool?.description ?? ''}</span>
      </div>
      <button class="close-btn" onclick={() => { panel.close(); running = false; }}><Icon name="close" size={11} /></button>
    </div>

    {#if panel.panelState === 'running'}
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
