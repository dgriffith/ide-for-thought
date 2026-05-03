<script lang="ts">
  import Ribbon from './Ribbon.svelte';
  import { scanFootnotes, type FootnoteDefinition, type FootnoteReference } from '../../footnotes';

  interface Props {
    content: string;
    onScrollToLine: (line: number) => void;
  }

  let { content, onScrollToLine }: Props = $props();

  let search = $state('');

  const scan = $derived(scanFootnotes(content));

  /**
   * View-model: one row per definition, plus a row per missing
   * reference (those don't have a definition to anchor them).
   * Definitions are listed in source order; missing-ref rows follow.
   */
  interface Row {
    kind: 'def' | 'orphan' | 'missing';
    label: string;
    body: string;
    /** Line to scroll to on click (1-based). */
    targetLine: number;
  }

  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    const refsByLabel = new Map<string, FootnoteReference[]>();
    for (const r of scan.references) {
      const arr = refsByLabel.get(r.label) ?? [];
      arr.push(r);
      refsByLabel.set(r.label, arr);
    }
    // Definitions first, in source order. Click jumps to first
    // in-text reference if any, else to the definition itself —
    // matches what users expect from "show me where this is used".
    for (const d of scan.definitions) {
      const refs = refsByLabel.get(d.label);
      const isOrphan = !refs || refs.length === 0;
      const target = refs && refs[0] ? refs[0].line : d.defLine;
      out.push({
        kind: isOrphan ? 'orphan' : 'def',
        label: d.label,
        body: previewBody(d),
        targetLine: target,
      });
    }
    // Missing references: one row per unique missing label, pointing
    // at the first occurrence so the user can fix it.
    const seenMissing = new Set<string>();
    for (const r of scan.missingReferences) {
      if (seenMissing.has(r.label)) continue;
      seenMissing.add(r.label);
      out.push({
        kind: 'missing',
        label: r.label,
        body: 'No definition',
        targetLine: r.line,
      });
    }
    return out;
  });

  const visibleRows = $derived.by<Row[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.label.toLowerCase().includes(q) || r.body.toLowerCase().includes(q));
  });

  function previewBody(d: FootnoteDefinition): string {
    const collapsed = d.body.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= 80) return collapsed;
    return collapsed.slice(0, 77) + '…';
  }

  function rowTitle(r: Row): string {
    if (r.kind === 'orphan') return `Footnote [^${r.label}] is defined but never referenced`;
    if (r.kind === 'missing') return `Footnote [^${r.label}] is referenced but never defined`;
    return `Jump to first use of [^${r.label}]`;
  }
</script>

<div class="footnotes-panel">
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find footnote…"
  />
  <div class="footnotes-scroll">
    {#if rows.length === 0}
      <div class="empty">No footnotes</div>
    {:else if visibleRows.length === 0}
      <div class="empty">No matches</div>
    {:else}
      <ul class="footnotes-list">
        {#each visibleRows as r}
          <li>
            <button
              class="footnote-item"
              class:orphan={r.kind === 'orphan'}
              class:missing={r.kind === 'missing'}
              title={rowTitle(r)}
              onclick={() => onScrollToLine(r.targetLine)}
            >
              <span class="label">[^{r.label}]</span>
              <span class="body">{r.body}</span>
              {#if r.kind === 'orphan'}
                <span class="marker" aria-label="Unused">○</span>
              {:else if r.kind === 'missing'}
                <span class="marker" aria-label="Missing">?</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .footnotes-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .footnotes-scroll {
    flex: 1;
    overflow-y: auto;
  }

  .footnotes-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }

  .footnote-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    border-radius: 3px;
  }

  .footnote-item:hover {
    background: var(--bg-button);
  }

  .label {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--accent);
    flex-shrink: 0;
  }

  .body {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .marker {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-muted);
    width: 14px;
    text-align: center;
  }

  .footnote-item.orphan .label,
  .footnote-item.missing .label {
    color: var(--text-muted);
  }
  .footnote-item.orphan .body,
  .footnote-item.missing .body {
    font-style: italic;
  }

  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
</style>
