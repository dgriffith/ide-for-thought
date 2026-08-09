<script lang="ts">
  import DraftCard from '../DraftCard.svelte';
  import ComputeDraftCard from '../ComputeDraftCard.svelte';
  import RefactorDraftCard from '../RefactorDraftCard.svelte';
  import ReorgDraftCard from '../ReorgDraftCard.svelte';
  import DeleteDraftCard from '../DeleteDraftCard.svelte';
  import NoteBodyDraftCard from '../NoteBodyDraftCard.svelte';
  import { getConversationsStore, type TabRuntime } from '../../stores/conversations.svelte';
  import { getEditorStore } from '../../stores/editor.svelte';
  import {
    formatPropertyValue,
    sourceLabel,
    basename,
    sourceKindLabel,
  } from '../../conversations/conversation-display';
  import type { ConversationDraft } from '../../../../shared/conversation-drafts';
  import type {
    ConversationSourceDraft,
    SourceIngestOutcome,
  } from '../../../../shared/conversation-source-drafts';
  import type {
    ConversationPropertyDraft,
    PropertyUpdateOutcome,
  } from '../../../../shared/conversation-property-drafts';
  import type {
    ConversationSourcePropertyDraft,
    SourcePropertyOutcome,
  } from '../../../../shared/conversation-source-property-drafts';
  import type {
    ConversationClaimsDraft,
    ClaimsOutcome,
  } from '../../../../shared/conversation-claims-drafts';
  import type { ConversationComputeDraft } from '../../../../shared/conversation-compute-drafts';
  import type {
    ConversationRefactorDraft,
    ConversationReorgDraft,
    ConversationDeleteDraft,
  } from '../../../../shared/conversation-refactor-drafts';
  import type { ConversationNoteBodyDraft } from '../../../../shared/conversation-note-body-drafts';

  interface Props {
    /** The active conversation tab whose drafts we render. */
    tab: TabRuntime;
    /** Message index this stack is anchored to; `null` renders the orphans —
     *  cards anchored past the current message list (in-flight / post-cancel). */
    index: number | null;
  }

  let { tab, index }: Props = $props();

  const store = getConversationsStore();
  const editor = getEditorStore();

  let expandedDraftIds = $state<Set<string>>(new Set());

  // Cards carry an `afterMessageIndex`; render each right after the message it's
  // anchored to. `pick` selects the drafts/results for this stack's anchor —
  // an exact index, or (index === null) every card anchored past the current
  // message list, which render as orphans at the bottom.
  function pick<T extends { afterMessageIndex: number }>(arr: T[]): T[] {
    return index === null
      ? arr.filter((d) => d.afterMessageIndex >= tab.conversation.messages.length)
      : arr.filter((d) => d.afterMessageIndex === index);
  }
  function pickResults<E extends { afterMessageIndex: number }>(rec: Record<string, E>): [string, E][] {
    const entries = Object.entries(rec);
    return index === null
      ? entries.filter(([, e]) => e.afterMessageIndex >= tab.conversation.messages.length)
      : entries.filter(([, e]) => e.afterMessageIndex === index);
  }

  function toggleDraftPath(key: string) {
    const next = new Set(expandedDraftIds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedDraftIds = next;
  }

  async function handleApprove(tabId: string, draft: ConversationDraft) {
    try {
      const { filedPaths } = await store.approveDraft(tabId, draft);
      // Open the first filed note so the user lands on what they just approved.
      if (filedPaths.length > 0) void editor.openFile(filedPaths[0]!);
    } catch (e) {
      console.error('[conv-panel] approve failed:', e);
    }
  }

  function handleDiscard(tabId: string, draftId: string) {
    store.discardDraft(tabId, draftId);
  }

  async function handleApproveRefactor(tabId: string, draft: ConversationRefactorDraft) {
    try {
      await store.approveRefactorDraft(tabId, draft);
      // Land the user on the note at its new path. A folder move has no single
      // file to open — the file tree refreshes from the watcher instead.
      if (!draft.isFolder) void editor.openFile(draft.toPath);
    } catch (e) {
      console.error('[conv-panel] approve refactor failed:', e);
    }
  }

  function handleDiscardRefactor(tabId: string, draftId: string) {
    store.discardRefactorDraft(tabId, draftId);
  }

  async function handleApproveReorg(
    tabId: string, draft: ConversationReorgDraft, selected: Array<{ fromPath: string; toPath: string }>,
  ) {
    try {
      await store.approveReorgDraft(tabId, draft, selected);
      // Land on the first moved note at its new path.
      if (selected.length > 0) void editor.openFile(selected[0]!.toPath);
    } catch (e) {
      console.error('[conv-panel] approve reorg failed:', e);
    }
  }

  function handleDiscardReorg(tabId: string, draftId: string) {
    store.discardReorgDraft(tabId, draftId);
  }

  async function handleApproveDelete(
    tabId: string, draft: ConversationDeleteDraft, selected: string[],
  ) {
    try {
      await store.approveDeleteDraft(tabId, draft, selected);
    } catch (e) {
      console.error('[conv-panel] approve delete failed:', e);
    }
  }

  function handleDiscardDelete(tabId: string, draftId: string) {
    store.discardDeleteDraft(tabId, draftId);
  }

  async function handleApproveNoteBody(
    tabId: string,
    draft: ConversationNoteBodyDraft,
    selected: string[],
  ) {
    try {
      await store.approveNoteBodyDraft(tabId, draft, selected);
    } catch (e) {
      console.error('[conv-panel] approve note-body rewrite failed:', e);
    }
  }

  function handleDiscardNoteBody(tabId: string, draftId: string) {
    store.discardNoteBodyDraft(tabId, draftId);
  }

  async function handleApproveSource(tabId: string, draft: ConversationSourceDraft) {
    try {
      await store.approveSourceDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve source failed:', e);
    }
  }

  function handleDiscardSource(tabId: string, draftId: string) {
    store.discardSourceDraft(tabId, draftId);
  }

  async function handleApproveProperty(tabId: string, draft: ConversationPropertyDraft) {
    try {
      await store.approvePropertyDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve property failed:', e);
    }
  }

  function handleDiscardProperty(tabId: string, draftId: string) {
    store.discardPropertyDraft(tabId, draftId);
  }

  async function handleApproveSourceProperty(tabId: string, draft: ConversationSourcePropertyDraft) {
    try {
      await store.approveSourcePropertyDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve source property failed:', e);
    }
  }

  function handleDiscardSourceProperty(tabId: string, draftId: string) {
    store.discardSourcePropertyDraft(tabId, draftId);
  }

  async function handleApproveClaims(tabId: string, draft: ConversationClaimsDraft) {
    try {
      await store.approveClaimsDraft(tabId, draft);
    } catch (e) {
      console.error('[conv-panel] approve claims failed:', e);
    }
  }

  function handleDiscardClaims(tabId: string, draftId: string) {
    store.discardClaimsDraft(tabId, draftId);
  }

  // ── propose_compute card actions (#245) ───────────────────────────
  // The edit buffer / edit mode / risky-ack live inside ComputeDraftCard
  // (per-card view state); we only forward the three store actions and the run
  // state. `edited` is undefined when the cell was never edited.
  function onRunCompute(draft: ConversationComputeDraft, edited: string | undefined): void {
    void store.runComputeDraft(tab.id, draft, edited);
  }

  function onInsertCompute(draft: ConversationComputeDraft, edited: string | undefined): void {
    void store.insertComputeDraft(tab.id, draft, edited);
  }

  function onDiscardCompute(draft: ConversationComputeDraft): void {
    store.discardComputeDraft(tab.id, draft.draftId);
  }

  function openInsertedNote(path: string): void {
    void editor.openFile(path);
  }

  function openFiledNote(relativePath: string) {
    void editor.openFile(relativePath);
  }

  function openFiledSource(sourceId: string) {
    editor.openSource(sourceId);
  }
</script>

{#snippet noteDraftCard(draft: ConversationDraft)}
  <DraftCard
    headline={`${draft.payloads.length} note${draft.payloads.length === 1 ? '' : 's'}`}
    note={draft.note}
    approveLabel="Approve & file"
    onApprove={() => handleApprove(tab.id, draft)}
    onDiscard={() => handleDiscard(tab.id, draft.draftId)}
  >
    <ul class="draft-paths">
      {#each draft.payloads as p}
        {@const key = draft.draftId + ':' + p.relativePath}
        <li>
          <button type="button" class="draft-path-btn" onclick={() => toggleDraftPath(key)}>
            <span class="draft-path">{p.relativePath}</span>
            <span class="draft-toggle">{expandedDraftIds.has(key) ? '▾' : '▸'}</span>
          </button>
          {#if expandedDraftIds.has(key)}
            <pre class="draft-preview">{p.content}</pre>
          {/if}
        </li>
      {/each}
    </ul>
  </DraftCard>
{/snippet}

{#snippet sourceDraftCardBlock(draft: ConversationSourceDraft)}
  <DraftCard
    headline={`📚 ${draft.sources.length} source${draft.sources.length === 1 ? '' : 's'}`}
    note={draft.note}
    approveLabel="Approve & ingest"
    onApprove={() => handleApproveSource(tab.id, draft)}
    onDiscard={() => handleDiscardSource(tab.id, draft.draftId)}
  >
    <ul class="source-list">
      {#each draft.sources as s, si (si)}
        <li>
          <span class="source-kind">{sourceKindLabel(s)}</span>
          <span class="source-value">{sourceLabel(s)}</span>
        </li>
      {/each}
    </ul>
  </DraftCard>
{/snippet}

{#snippet sourceResultLine(_draftId: string, outcomes: SourceIngestOutcome[])}
  <!-- Compact "Filed:" line that replaces the propose_sources card after
       Approve. Each successfully filed source title is a clickable link that
       opens the source in the editor; failures are shown muted in-line. The line
       is persistent (no dismiss) — it lives in the transcript. -->
  <div class="filed-line">
    <span class="filed-prefix">📚 Filed:</span>
    {#each outcomes as o, oi (oi)}
      {#if oi > 0}<span class="filed-sep">·</span>{/if}
      {#if o.error}
        <span class="filed-error" title={o.error}>⚠ {sourceLabel(o.input)}</span>
      {:else if o.sourceId}
        <button
          type="button"
          class="filed-link"
          title={o.duplicate ? 'Already in library — open' : 'Open source'}
          onclick={() => openFiledSource(o.sourceId!)}
        >{o.title ?? sourceLabel(o.input)}{#if o.duplicate}<span class="filed-dup"> · already in library</span>{/if}</button>
      {:else}
        <span class="filed-error">{sourceLabel(o.input)}</span>
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet noteResultLine(_draftId: string, filedPaths: string[])}
  <!-- Counterpart to sourceResultLine for propose_notes. Drops in where the
       draft card was so the user knows what filed and can jump to any new note. -->
  <div class="filed-line">
    <span class="filed-prefix">📝 Filed:</span>
    {#if filedPaths.length === 0}
      <span class="filed-error">(no notes written)</span>
    {:else}
      {#each filedPaths as p, pi (p)}
        {#if pi > 0}<span class="filed-sep">·</span>{/if}
        <button
          type="button"
          class="filed-link"
          title={p}
          onclick={() => openFiledNote(p)}
        >{basename(p)}</button>
      {/each}
    {/if}
  </div>
{/snippet}

{#snippet propertyDraftCardBlock(draft: ConversationPropertyDraft)}
  <!-- set_properties review card. Mirrors the source/note card chrome but shows
       the proposed frontmatter patch per note. Each value renders with its key
       so the user can eyeball the diff without clicking through to the file. -->
  <DraftCard
    headline={`🔑 ${draft.updates.length} note${draft.updates.length === 1 ? '' : 's'}`}
    note={draft.note}
    approveLabel="Approve & apply"
    onApprove={() => handleApproveProperty(tab.id, draft)}
    onDiscard={() => handleDiscardProperty(tab.id, draft.draftId)}
  >
    <ul class="property-update-list">
      {#each draft.updates as u, ui (ui)}
        <li class="property-update">
          <div class="property-update-path">{u.relativePath}</div>
          <ul class="property-kv-list">
            {#each Object.entries(u.properties) as [k, v] (k)}
              <li class="property-kv" class:property-kv-delete={v === null}>
                <span class="property-key">{k}:</span>
                <span class="property-value">{formatPropertyValue(v)}</span>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  </DraftCard>
{/snippet}

{#snippet sourcePropertyDraftCardBlock(draft: ConversationSourcePropertyDraft)}
  <!-- propose_source_properties review card (#103). Shows the proposed abstract
       / TL;DR for one source; Approve upserts dc:abstract / thought:tldr. -->
  <DraftCard
    headline="📄 Source summary"
    note={draft.note}
    approveLabel="Approve & apply"
    onApprove={() => handleApproveSourceProperty(tab.id, draft)}
    onDiscard={() => handleDiscardSourceProperty(tab.id, draft.draftId)}
  >
    <div class="property-update-path">{draft.sourceId}</div>
    {#if draft.abstract}
      <div class="source-prop-block">
        <div class="source-prop-label">Abstract</div>
        <div class="source-prop-text">{draft.abstract}</div>
      </div>
    {/if}
    {#if draft.tldr}
      <div class="source-prop-block">
        <div class="source-prop-label">TL;DR</div>
        <div class="source-prop-text">{draft.tldr}</div>
      </div>
    {/if}
  </DraftCard>
{/snippet}

{#snippet sourcePropertyResultLine(_draftId: string, outcome: SourcePropertyOutcome)}
  <div class="filed-line">
    <span class="filed-prefix">📄 Updated:</span>
    {#if outcome.error}
      <span class="filed-error" title={outcome.error}>⚠ {outcome.sourceId}</span>
    {:else if outcome.changedPredicates.length === 0}
      <span class="filed-error">{outcome.sourceId} · no change</span>
    {:else}
      <span class="filed-link" title={outcome.sourceId}>{outcome.sourceId} · {outcome.changedPredicates.join(', ')}</span>
    {/if}
  </div>
{/snippet}

{#snippet claimsDraftCardBlock(draft: ConversationClaimsDraft)}
  <!-- propose_claims review card (#104). Each claim shows its kind, confidence,
       and the supporting quote; Approve files claim notes + excerpt nodes. -->
  <DraftCard
    headline={`🧩 ${draft.claims.length} claim${draft.claims.length === 1 ? '' : 's'}`}
    note={draft.note}
    approveLabel="Approve & file"
    onApprove={() => handleApproveClaims(tab.id, draft)}
    onDiscard={() => handleDiscardClaims(tab.id, draft.draftId)}
  >
    <ul class="claims-list">
      {#each draft.claims as c, ci (ci)}
        <li class="claim-item">
          <div class="claim-head">
            <span class="claim-kind">{c.kind}</span>
            <span class="claim-conf">conf {c.confidence.toFixed(2)}</span>
            {#if !c.quoteFound}<span class="claim-approx" title="Quote wasn't a verbatim substring of the body — excerpt files without a character anchor">approx</span>{/if}
          </div>
          <div class="claim-text">{c.text}</div>
          <div class="claim-quote">{c.quote}</div>
        </li>
      {/each}
    </ul>
  </DraftCard>
{/snippet}

{#snippet claimsResultLine(_draftId: string, outcome: ClaimsOutcome)}
  <div class="filed-line">
    <span class="filed-prefix">🧩 Filed:</span>
    {#if outcome.error}
      <span class="filed-error" title={outcome.error}>⚠ {outcome.sourceId}</span>
    {:else}
      {#each outcome.claimPaths as p, pi (p)}
        {#if pi > 0}<span class="filed-sep">·</span>{/if}
        <button type="button" class="filed-link" title={p} onclick={() => openFiledNote(p)}>{basename(p)}</button>
      {/each}
      <span class="filed-dup"> · {outcome.excerptIds.length} excerpt{outcome.excerptIds.length === 1 ? '' : 's'}</span>
    {/if}
  </div>
{/snippet}

{#snippet propertyResultLine(_draftId: string, outcomes: PropertyUpdateOutcome[])}
  <!-- Compact "Updated:" line that replaces the propose-property card after
       Approve. Each successfully-patched path is a clickable link; the count of
       changed keys is shown so the user can confirm the patch landed. -->
  <div class="filed-line">
    <span class="filed-prefix">🔑 Updated:</span>
    {#if outcomes.length === 0}
      <span class="filed-error">(no notes touched)</span>
    {:else}
      {#each outcomes as o, oi (oi)}
        {#if oi > 0}<span class="filed-sep">·</span>{/if}
        {#if o.error}
          <span class="filed-error" title={o.error}>⚠ {basename(o.relativePath)}</span>
        {:else if o.changedKeys.length === 0}
          <button
            type="button"
            class="filed-link"
            title="{o.relativePath} — already up to date"
            onclick={() => openFiledNote(o.relativePath)}
          >{basename(o.relativePath)}<span class="filed-dup"> · no-op</span></button>
        {:else}
          <button
            type="button"
            class="filed-link"
            title="{o.relativePath} — {o.changedKeys.join(', ')}"
            onclick={() => openFiledNote(o.relativePath)}
          >{basename(o.relativePath)}<span class="filed-dup"> · {o.changedKeys.length} key{o.changedKeys.length === 1 ? '' : 's'}</span></button>
        {/if}
      {/each}
    {/if}
  </div>
{/snippet}

{#each pick(tab.drafts) as draft (draft.draftId)}
  {@render noteDraftCard(draft)}
{/each}
{#each pick(tab.sourceDrafts) as draft (draft.draftId)}
  {@render sourceDraftCardBlock(draft)}
{/each}
{#each pickResults(tab.sourceDraftResults) as [draftId, entry] (draftId)}
  {@render sourceResultLine(draftId, entry.outcomes)}
{/each}
{#each pickResults(tab.noteDraftResults) as [draftId, entry] (draftId)}
  {@render noteResultLine(draftId, entry.filedPaths)}
{/each}
{#each pick(tab.propertyDrafts) as draft (draft.draftId)}
  {@render propertyDraftCardBlock(draft)}
{/each}
{#each pickResults(tab.propertyDraftResults) as [draftId, entry] (draftId)}
  {@render propertyResultLine(draftId, entry.outcomes)}
{/each}
{#each pick(tab.sourcePropertyDrafts) as draft (draft.draftId)}
  {@render sourcePropertyDraftCardBlock(draft)}
{/each}
{#each pickResults(tab.sourcePropertyDraftResults) as [draftId, entry] (draftId)}
  {@render sourcePropertyResultLine(draftId, entry.outcome)}
{/each}
{#each pick(tab.claimsDrafts) as draft (draft.draftId)}
  {@render claimsDraftCardBlock(draft)}
{/each}
{#each pickResults(tab.claimsDraftResults) as [draftId, entry] (draftId)}
  {@render claimsResultLine(draftId, entry.outcome)}
{/each}
{#each pick(tab.computeDrafts) as draft (draft.draftId)}
  <ComputeDraftCard
    {draft}
    runState={tab.computeDraftState[draft.draftId]}
    onRun={onRunCompute}
    onInsert={onInsertCompute}
    onDiscard={onDiscardCompute}
    onOpenInserted={openInsertedNote}
  />
{/each}
{#each pick(tab.refactorDrafts) as draft (draft.draftId)}
  <RefactorDraftCard
    {draft}
    onApprove={() => handleApproveRefactor(tab.id, draft)}
    onDiscard={() => handleDiscardRefactor(tab.id, draft.draftId)}
  />
{/each}
{#each pick(tab.reorgDrafts) as draft (draft.draftId)}
  <ReorgDraftCard
    {draft}
    onApprove={(selected) => handleApproveReorg(tab.id, draft, selected)}
    onDiscard={() => handleDiscardReorg(tab.id, draft.draftId)}
  />
{/each}
{#each pick(tab.deleteDrafts) as draft (draft.draftId)}
  <DeleteDraftCard
    {draft}
    onApprove={(selected) => handleApproveDelete(tab.id, draft, selected)}
    onDiscard={() => handleDiscardDelete(tab.id, draft.draftId)}
  />
{/each}
{#each pick(tab.noteBodyDrafts) as draft (draft.draftId)}
  <NoteBodyDraftCard
    {draft}
    onApprove={(selected) => handleApproveNoteBody(tab.id, draft, selected)}
    onDiscard={() => handleDiscardNoteBody(tab.id, draft.draftId)}
  />
{/each}

<style>
  .draft-paths { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .draft-path-btn {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 4px 6px;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 3px;
  }
  .draft-path-btn:hover { background: var(--bg, var(--bg-sidebar)); }
  .draft-path { font-family: var(--font-mono, monospace); font-size: 12px; }
  .draft-toggle { color: var(--text-muted); margin-left: auto; }
  .draft-preview {
    margin: 4px 0 4px 18px;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    white-space: pre-wrap;
    overflow-x: auto;
    max-height: 280px;
  }

  /* propose_sources cards. Same outer chrome as note draft cards;
     interior shows a flat list of url/identifier pills rather than the
     expandable preview tree (we don't fetch metadata until Approve, so
     there's nothing to preview pre-ingest). */
  .source-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 3px; }
  .source-list li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 3px 6px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .source-kind {
    display: inline-block;
    min-width: 38px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg, var(--bg-sidebar));
    color: var(--text-muted);
    font-size: 10px;
    text-transform: uppercase;
    text-align: center;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .source-value {
    color: var(--text);
    overflow-wrap: anywhere;
  }

  /* set_properties review card interior. Each per-note patch is a
     small block with the relative path as a header and a key:value
     list underneath. Deleted keys render dimmed with a strikethrough
     marker so removals are visually distinct from sets. */
  .property-update-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .property-update {
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }
  .property-update-path {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 2px;
  }
  /* propose_source_properties card (#103). */
  .source-prop-block {
    margin: 6px 0;
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }
  .source-prop-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 2px;
  }
  .source-prop-text {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
  }
  /* propose_claims card (#104). */
  .claims-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .claim-item {
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }
  .claim-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 10px;
    margin-bottom: 2px;
  }
  .claim-kind {
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }
  .claim-conf { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .claim-approx {
    color: var(--bg);
    background: var(--text-muted);
    border-radius: 3px;
    padding: 0 4px;
  }
  .claim-text { font-size: 13px; color: var(--text); }
  .claim-quote {
    font-size: 11px;
    color: var(--text-muted);
    border-left: 2px solid var(--border);
    padding-left: 6px;
    margin-top: 2px;
    white-space: pre-wrap;
  }
  .property-kv-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .property-kv {
    display: flex;
    gap: 6px;
    font-size: 12px;
    padding: 1px 4px;
    font-family: var(--font-mono, monospace);
  }
  .property-key {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .property-value {
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .property-kv-delete .property-key,
  .property-kv-delete .property-value {
    color: var(--text-muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--text-muted) 60%, transparent);
  }

  /* Post-Approve summary line — replaces the inline draft card for
     both propose_notes and propose_sources. Single-line, no chrome,
     clickable filenames/titles. Persistent (no dismiss) so the user
     can scroll back later and still navigate to filed resources. */
  .filed-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    padding: 6px 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .filed-prefix {
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .filed-sep { color: var(--border); }
  .filed-link {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .filed-link:hover { text-decoration-color: var(--accent); }
  .filed-dup { color: var(--text-muted); text-decoration: none; }
  .filed-error { color: var(--text-muted); }
</style>
