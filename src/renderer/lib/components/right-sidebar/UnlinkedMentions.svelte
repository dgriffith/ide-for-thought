<script lang="ts">
  /**
   * Unlinked mentions of a typed object (#1074) — the inverse of RelatedPanel.
   * For the active note WHEN it is a typed object, list notes that semantically
   * mention it (pointed at its title + aliases) but don't wiki-link it, above the
   * suggestion threshold. "Link it" inserts a resolving `[[Object]]` into the
   * MENTIONING note (not this one). Dismissals persist. Nothing is written
   * without an explicit click. Self-gates: renders nothing for an untyped note.
   *
   * Reuses the embeddings stack, the threshold, and the See-also insertion; the
   * only inversion is the argument order of applySuggestedLink.
   */
  import type { RelatedNote } from '../../../../shared/types';
  import { slugify } from '../../../../shared/slug';
  import { api } from '../../ipc/client';
  import { linkSuggestionsStore } from '../../stores/link-suggestions.svelte';
  import Icon from '../Icon.svelte';

  interface Props {
    activeFilePath: string | null;
    revision: number;
    onFileSelect: (relativePath: string) => void;
    onNavigate?: (target: string) => void | Promise<void>;
  }
  let { activeFilePath, revision, onFileSelect, onNavigate }: Props = $props();

  // Same high-precision bar as RelatedPanel's suggest affordance.
  const SUGGEST_THRESHOLD = 0.45;

  let isTyped = $state(false);
  let mentions = $state<RelatedNote[]>([]);
  let justLinked = $state<Set<string>>(new Set());

  // Distinct persistence key from RelatedPanel so the two surfaces don't share
  // dismissals; keyed (object → mentioning note).
  const DISMISS_KEY = 'minerva.mentions.dismissed';
  let dismissed = $state<Set<string>>(loadDismissed());
  function loadDismissed(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[]); }
    catch { return new Set(); }
  }
  function pairKey(object: string, ref: string): string { return `${object} ${ref}`; }

  $effect(() => {
    const path = activeFilePath;
    revision; // refetch after a reindex (a mention may have gained/lost the link)
    if (!path) { isTyped = false; mentions = []; return; }
    justLinked = new Set();
    void (async () => {
      // Object-scoped: only a typed note has "object" mentions to claim.
      const props = await api.types.noteProperties(path);
      if (activeFilePath !== path) return;
      isTyped = props.type !== null;
      if (!isTyped) { mentions = []; return; }
      const res = await api.embeddings.unlinkedMentions(path);
      if (activeFilePath !== path) return;
      mentions = res.notes;
    })();
  });

  // The list is only the actionable, unlinked, high-similarity mentions.
  const shown = $derived(
    mentions.filter((m) =>
      m.kind === 'note'
      && m.alreadyLinked === false
      && m.score >= SUGGEST_THRESHOLD
      && !justLinked.has(m.ref)
      && !(activeFilePath != null && dismissed.has(pairKey(activeFilePath, m.ref)))),
  );

  function open(m: RelatedNote): void {
    const leaf = m.sectionHeading.split('>').pop()?.trim();
    if (leaf && onNavigate) void onNavigate(`${m.ref}#${slugify(leaf)}`);
    else onFileSelect(m.ref);
  }

  async function linkIt(m: RelatedNote): Promise<void> {
    if (!activeFilePath) return;
    justLinked = new Set(justLinked).add(m.ref); // optimistic
    try {
      // Inverse of RelatedPanel: insert [[thisObject]] INTO the mentioning note.
      // Routed via the store — the write is a mutation and belongs there, not in
      // this component (renderer data-flow rule #1086/#1626).
      await linkSuggestionsStore.applySuggestedLink(m.ref, activeFilePath);
    } catch {
      const next = new Set(justLinked); next.delete(m.ref); justLinked = next;
    }
  }

  function dismiss(m: RelatedNote): void {
    if (!activeFilePath) return;
    dismissed = new Set(dismissed).add(pairKey(activeFilePath, m.ref));
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed])); } catch { /* quota / private mode */ }
  }

  function pct(score: number): number { return Math.round(Math.max(0, Math.min(1, score)) * 100); }
</script>

{#if isTyped && shown.length > 0}
  <div class="mentions">
    <div class="mentions-head" title="Notes that mention this object but don't link it">
      Unlinked mentions <span class="count">{shown.length}</span>
    </div>
    {#each shown as m (m.ref)}
      <div class="mention">
        <button class="mention-open" onclick={() => open(m)} title={m.ref}>
          <div class="row-top">
            <Icon name="notes" size={11} color="var(--text-faint)" />
            <span class="mention-title">{m.title}</span>
            <span class="score" title="{pct(m.score)}% similar"><span class="score-bar" style:width="{pct(m.score)}%"></span></span>
          </div>
          <div class="mention-snippet">{m.snippet}</div>
        </button>
        <div class="actions">
          <button class="act link" onclick={() => linkIt(m)} title="Insert a [[link]] to this object into that note, under “See also”">
            <Icon name="link" size={12} />
          </button>
          <button class="act dismiss" onclick={() => dismiss(m)} title="Dismiss" aria-label="Dismiss">×</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .mentions { border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .mentions-head {
    padding: 8px 12px 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    color: var(--text-faint);
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .count { font-variant-numeric: tabular-nums; }
  .mention { display: flex; align-items: stretch; border-left: 2px solid color-mix(in oklch, var(--accent) 45%, transparent); }
  .mention:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  .mention-open {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;
    padding: 7px 4px 7px 12px; border: none; background: none; color: var(--text);
    font-family: var(--font-sans); cursor: pointer; text-align: left;
  }
  .row-top { display: flex; align-items: center; gap: 6px; }
  .mention-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .score { flex-shrink: 0; width: 36px; height: 4px; border-radius: 2px; background: color-mix(in oklch, var(--text) 10%, transparent); overflow: hidden; }
  .score-bar { display: block; height: 100%; background: var(--text-faint); }
  .mention-snippet {
    font-size: 11px; color: var(--text-muted); line-height: 1.4; padding-left: 17px;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .actions { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 0 6px; flex-shrink: 0; }
  .act {
    display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
    border: none; background: none; border-radius: 4px; cursor: pointer; color: var(--text-muted); font-size: 15px; line-height: 1;
  }
  .act:hover { background: var(--bg-button); color: var(--text); }
  .act.link { color: var(--accent); }
  .act.dismiss { opacity: 0; }
  .mention:hover .act.dismiss { opacity: 1; }
</style>
