<script lang="ts">
  /**
   * Argument-entry modal for tools/skills that declare `parameters`. Replaces
   * the old bottom-panel "configure" form with a dismissable modal (the standard
   * dialog shell shared with PromptDialog). Streaming + review still live in the
   * bottom ToolPanel — only arg entry moved here.
   *
   * Owns the local form state (param values + the lazily-loaded note-picker
   * options); hands the raw values back via `onRun`. The caller resolves
   * note-picker params and drives execution, so this stays a dumb form.
   */
  import { api } from '../ipc/client';
  import { flattenNoteFiles } from '../tools/resolve-note-params';
  import type { ThinkingToolInfo, ToolContext } from '../../../shared/tools/types';

  interface Props {
    tool: ThinkingToolInfo;
    context: ToolContext;
    onRun: (values: Record<string, string>) => void;
    onCancel: () => void;
  }

  let { tool, context, onRun, onCancel }: Props = $props();

  const params = $derived(tool.parameters ?? []);

  let paramValues = $state<Record<string, string>>(
    Object.fromEntries((tool.parameters ?? []).map((p) => [p.id, p.defaultValue ?? ''])),
  );
  // Note-picker (#516) options — flat list of project .md files, loaded lazily
  // when a tool has a `note` parameter.
  let noteOptions = $state<{ name: string; relativePath: string }[]>([]);
  let dialogEl = $state<HTMLElement>();

  $effect(() => {
    if (params.some((p) => p.type === 'note') && noteOptions.length === 0) {
      void api.notebase.listFiles().then((tree) => { noteOptions = flattenNoteFiles(tree); });
    }
  });

  // Focus the first field so the user can start typing immediately.
  $effect(() => { dialogEl?.querySelector<HTMLElement>('input, textarea, select')?.focus(); });

  function run() {
    onRun($state.snapshot(paramValues));
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      run();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown} onmousedown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="tool-params-title" bind:this={dialogEl}>
    <header class="card-header">
      <div class="eyebrow">{tool.description || 'Tool'}</div>
      <h2 class="title" id="tool-params-title">{tool.name}</h2>
    </header>

    <div class="body">
      {#if tool.longDescription}
        <p class="tool-info">{tool.longDescription}</p>
      {/if}

      {#if params.length > 0}
        <div class="params">
          {#each params as param (param.id)}
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
              {:else if param.type === 'note'}
                <input
                  list={`notes-${param.id}`}
                  bind:value={paramValues[param.id]}
                  placeholder={param.placeholder ?? 'Type to find a note…'}
                />
                <datalist id={`notes-${param.id}`}>
                  {#each noteOptions as n (n.relativePath)}
                    <option value={n.relativePath}>{n.name}</option>
                  {/each}
                </datalist>
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

      {#if context.selectedText}
        <div class="context-preview">Selected text ({context.selectedText.length} chars)</div>
      {:else if context.fullNoteContent}
        <div class="context-preview">Full note: {context.fullNoteTitle ?? 'Untitled'}</div>
      {/if}
    </div>

    <footer class="card-footer">
      <span class="kbd-hint">esc · cancel · ⌘↵ run</span>
      <span class="footer-actions">
        <button class="btn secondary" onclick={onCancel}>Cancel</button>
        <button class="btn primary" onclick={run}>
          Run
          <span class="btn-kbd">⌘↵</span>
        </button>
      </span>
    </footer>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(20, 14, 6, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }

  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    width: 460px;
    max-width: 100%;
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    color: var(--text);
    overflow: hidden;
  }

  .card-header {
    padding: 20px 24px 0;
  }
  .eyebrow {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -0.005em;
    line-height: 1.3;
    color: var(--text);
  }

  .body {
    padding: 14px 24px 18px;
    overflow-y: auto;
  }
  .tool-info {
    margin: 0 0 14px;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .params {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-inset);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
  }
  .param-label input:focus,
  .param-label textarea:focus,
  .param-label select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
  }

  .context-preview {
    margin-top: 12px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg);
    border-radius: 0 0 12px 12px;
  }
  .kbd-hint {
    margin-right: auto;
    font-size: 10.5px;
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .footer-actions {
    display: inline-flex;
    gap: 8px;
  }

  .btn {
    padding: 7px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .secondary {
    background: transparent;
    color: var(--text-muted);
  }
  .secondary:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .primary:hover {
    opacity: 0.92;
  }
  .btn-kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.7;
  }
</style>
