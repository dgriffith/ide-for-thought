<script lang="ts">
  /**
   * A query view's header names its source (#2948, epic #2936): the saved
   * query's file, which opens it in the Query panel, or "Inline query", which
   * shows its text. Read-only: opening the query is the editor store's, and
   * the text shown is the spec's own.
   */
  import { api } from '../ipc/client';
  import { getEditorStore } from '../stores/editor.svelte';
  import { queryFileLanguage, queryFileName, type QuerySourceSpec } from '../../../shared/views/view-source-spec';

  interface Props {
    spec: QuerySourceSpec;
  }
  let { spec }: Props = $props();

  const editor = getEditorStore();
  let shown = $state(false);
  let missing = $state(false);

  /** Open the saved query in the Query panel, to read or edit it. */
  async function openFile(name: string): Promise<void> {
    const found = (await api.queries.list()).find((q) => queryFileName(q.filePath) === name);
    if (!found) { missing = true; return; }
    editor.openQuery(found.query, found.language ?? queryFileLanguage(name));
  }
</script>

<span class="tv-source">
  {#if spec.kind === 'queryFile'}
    from <button type="button" class="tv-source-btn" title="Open {spec.queryFile} in the Query panel" onclick={() => void openFile(spec.queryFile)}>{spec.queryFile}</button>{#if missing}<span class="tv-source-missing"> (not found)</span>{/if}
  {:else}
    <button type="button" class="tv-source-btn" aria-expanded={shown} onclick={() => { shown = !shown; }}>Inline query</button>
    {#if shown}<pre class="tv-source-text">{spec.query}</pre>{/if}
  {/if}
</span>

<style>
  .tv-source { font-size: 12px; color: var(--text-muted); position: relative; }
  .tv-source-btn {
    padding: 0 4px; border: none; border-radius: 3px; background: transparent;
    color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
  }
  .tv-source-btn:hover { background: color-mix(in oklch, var(--accent) 12%, transparent); }
  .tv-source-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .tv-source-text {
    position: absolute; z-index: 5; top: 100%; left: 0; margin: 4px 0 0; padding: 8px 10px;
    max-width: 60ch; max-height: 40vh; overflow: auto; white-space: pre-wrap;
    border: 1px solid var(--border); border-radius: 6px; background: var(--bg-button); color: var(--text);
    font-family: var(--font-mono, monospace); font-size: 11.5px;
  }
</style>
