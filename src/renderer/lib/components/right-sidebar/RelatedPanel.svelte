<script lang="ts">
  import type { RelatedNote } from '../../../../shared/types';
  import { getRelatedNotes } from '../../sidebar-related';
  import { slugify } from '../../../../shared/slug';
  import Icon from '../Icon.svelte';

  interface Props {
    activeFilePath: string | null;
    revision: number;
    /** True while the background backfill is embedding the corpus (#836) — lets
     *  an empty result read as "indexing" rather than "nothing related". */
    indexing?: boolean;
    onFileSelect: (relativePath: string) => void;
    /** Opens a note and scrolls to a heading anchor (`path#slug`). */
    onNavigate?: (target: string) => void | Promise<void>;
    /** Route source / excerpt hits to the source viewer (#839). */
    onOpenSource?: (sourceId: string) => void;
    onOpenExcerpt?: (excerptId: string) => void;
  }

  let { activeFilePath, revision, indexing = false, onFileSelect, onNavigate, onOpenSource, onOpenExcerpt }: Props = $props();

  const KIND_ICON = { note: 'notes', source: 'source', excerpt: 'citations' } as const;

  let notes = $state<RelatedNote[]>([]);
  let enabled = $state(true);
  let loading = $state(false);

  $effect(() => {
    const path = activeFilePath;
    const rev = revision;
    if (!path) { notes = []; enabled = true; return; }
    loading = true;
    void getRelatedNotes(path, rev).then((res) => {
      // Guard against a stale resolution after the user switched notes.
      if (activeFilePath !== path) return;
      notes = res.notes;
      enabled = res.enabled;
      loading = false;
    });
  });

  /** Route a hit by kind: notes scroll to the matched section; sources/excerpts
   *  open the source viewer (with the excerpt highlighted). */
  function open(note: RelatedNote) {
    if (note.kind === 'source') { onOpenSource?.(note.ref); return; }
    if (note.kind === 'excerpt') { onOpenExcerpt?.(note.ref); return; }
    const leaf = note.sectionHeading.split('>').pop()?.trim();
    if (leaf && onNavigate) {
      void onNavigate(`${note.ref}#${slugify(leaf)}`);
    } else {
      onFileSelect(note.ref);
    }
  }

  function pct(score: number): number {
    return Math.round(Math.max(0, Math.min(1, score)) * 100);
  }
</script>

<div class="related-panel">
  <div class="scroll">
    {#if !enabled}
      <div class="empty">Semantic search is not available for this thoughtbase.</div>
    {:else if notes.length === 0}
      {#if loading}
        <div class="empty">Finding related notes…</div>
      {:else if indexing}
        <div class="empty">Indexing… related notes will appear as embedding completes.</div>
      {:else}
        <div class="empty">No related notes found.</div>
      {/if}
    {:else}
      <div class="related-count">{notes.length} related note{notes.length !== 1 ? 's' : ''}</div>
      {#each notes as note (note.kind + ':' + note.ref)}
        <button class="related-item" onclick={() => open(note)} title={note.kind === 'note' ? note.ref : `${note.kind}: ${note.ref}`}>
          <div class="row-top">
            <Icon name={KIND_ICON[note.kind]} size={11} color="var(--text-faint)" />
            <span class="related-title">{note.title}</span>
            <span class="score" title="{pct(note.score)}% similar">
              <span class="score-bar" style:width="{pct(note.score)}%"></span>
            </span>
          </div>
          {#if note.sectionHeading}
            <div class="related-section">{note.sectionHeading}</div>
          {/if}
          <div class="related-snippet">{note.snippet}</div>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .related-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .related-count {
    padding: 6px 12px 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
    letter-spacing: 0.04em;
  }
  .related-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 7px 12px;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: var(--text);
    font-family: var(--font-sans);
    cursor: pointer;
    text-align: left;
  }
  .related-item:hover {
    background: color-mix(in oklch, var(--text) 4%, transparent);
    border-left-color: var(--accent);
  }
  .row-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .related-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }
  /* Quiet similarity affordance — a muted bar, no alarm colors (per UI philosophy). */
  .score {
    flex-shrink: 0;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: color-mix(in oklch, var(--text) 10%, transparent);
    overflow: hidden;
  }
  .score-bar {
    display: block;
    height: 100%;
    background: var(--text-faint);
  }
  .related-section {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 17px;
  }
  .related-snippet {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding-left: 17px;
  }
  .empty { padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center; }
</style>
