<script lang="ts">
  /**
   * The numbered citation list under an assistant message (#672, extracted
   * from ConversationsPanel). Presentational: it renders each citation as an
   * external link plus a "cite" action whose label tracks the per-citation
   * progress the panel hands in. The panel owns the cite state and the ingest
   * orchestration; this child only reports clicks back.
   */
  import type { Citation } from '../../../shared/types';
  import { hostOf, type CiteStatus } from '../conversations/citations';
  import { noteBasename } from '../conversations/cite-from-conversation';

  interface Props {
    citations: Citation[];
    /** Note the citation would be filed into, or null when none is open. */
    targetPath: string | null;
    /** Per-citation cite progress, by index within this message. */
    citeStateFor: (ci: number) => CiteStatus | undefined;
    onOpenExternal: (url: string) => void;
    onCite: (ci: number, cite: Citation) => void;
  }

  let { citations, targetPath, citeStateFor, onOpenExternal, onCite }: Props = $props();
</script>

<ol class="citations">
  {#each citations as cite, ci}
    {@const st = citeStateFor(ci)}
    <li>
      <button type="button" class="citation-link" onclick={() => onOpenExternal(cite.url)} title={cite.citedText}>
        <span class="citation-num">[{ci + 1}]</span>
        <span class="citation-title">{cite.title ?? hostOf(cite.url)}</span>
        <span class="citation-host">{hostOf(cite.url)}</span>
      </button>
      {#if st?.phase === 'done'}
        <span class="cite-action done" title="Filed as a source and cited from this note">✓ cited</span>
      {:else if st?.phase === 'error'}
        <button type="button" class="cite-action error" title={st.message} onclick={() => onCite(ci, cite)}>retry</button>
      {:else}
        <button
          type="button"
          class="cite-action"
          disabled={!targetPath || st?.phase === 'running'}
          title={targetPath ? `Ingest as a source and cite from ${noteBasename(targetPath)}` : 'No note to cite into — open one in the editor'}
          onclick={() => onCite(ci, cite)}
        >{st?.phase === 'running' ? 'citing…' : 'cite'}</button>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .citations {
    list-style: none;
    margin: 8px 0 4px 0;
    padding: 6px 10px;
    border-left: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .citation-link {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 2px 0;
    border: none;
    background: none;
    color: var(--text);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .citation-link:hover .citation-title { text-decoration: underline; }
  .citation-num { color: var(--text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .citation-title { color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .citation-host { color: var(--text-muted); font-size: 10px; flex-shrink: 0; margin-left: auto; }
  .citations li { display: flex; align-items: baseline; gap: 8px; }
  .cite-action {
    flex-shrink: 0;
    border: none;
    background: none;
    padding: 2px 4px;
    font-size: 10px;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 3px;
  }
  .cite-action:hover:not(:disabled) { color: var(--accent); background: var(--bg-button); }
  .cite-action:disabled { opacity: 0.4; cursor: default; }
  .cite-action.done { color: var(--accent); cursor: default; }
  .cite-action.error { color: var(--text); }
</style>
