<script lang="ts">
  import { getReviewStore } from '../stores/review.svelte';
  import { getProposalsStore } from '../stores/proposals.svelte';
  import Ribbon from './right-sidebar/Ribbon.svelte';
  import { describeProposer } from '../../../shared/provenance';
  import { logger } from '../../../shared/logger';

  const review = getReviewStore();
  const store = getProposalsStore();

  type NotePayload = { kind: 'note'; relativePath: string; content: string };
  type TriplesPayload = { kind: 'graph-triples'; turtle: string; affectsNodeUris: string[] };
  type Payload = NotePayload | TriplesPayload | { kind: string; [k: string]: unknown };

  interface Proposal {
    uri: string;
    status: string;
    operationType: string;
    note: string;
    proposedBy: string;
    proposedAt: string;
    payloads: Payload[];
  }

  let selectedUri = $state<string | null>(null);
  let expandedPayloads = $state<Set<string>>(new Set());
  let processing = $state(false);
  let lastError = $state<string | null>(null);
  let lastSuccess = $state<string | null>(null);
  let search = $state('');
  let sortId = $state<'time' | 'type'>('time');
  // Most in-app flows auto-approve (inline draft cards), so "all" makes the
  // audit trail visible; "pending" is a one-click toggle for triage. Fleet
  // agents (#1524) file straight to pending, so this panel is where they land.
  let statusFilter = $state<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // The store holds the FULL, always-live set (updates on out-of-process
  // changes). We filter + sort it here; `payloads` is typed loosely upstream.
  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    let list = store.proposals as unknown as Proposal[];
    if (statusFilter !== 'all') list = list.filter((p) => p.status === statusFilter);
    if (q) {
      list = list.filter((p) =>
        p.note.toLowerCase().includes(q) ||
        p.operationType.toLowerCase().includes(q) ||
        p.proposedBy.toLowerCase().includes(q),
      );
    }
    const sorted = [...list].sort((a, b) =>
      sortId === 'type'
        ? a.operationType.localeCompare(b.operationType)
        // Newest first — what a reviewer reaches for when new proposals land
        // while older ones sit waiting.
        : b.proposedAt.localeCompare(a.proposedAt),
    );
    // Group pending first regardless of sort (stable sort preserves the inner
    // order) — the review queue sits on top of the audit trail.
    return sorted.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
  });

  async function handleApprove(uri: string) {
    processing = true;
    lastError = null;
    lastSuccess = null;
    // Snapshot the payload summary BEFORE approve flips status, so the success
    // banner can say exactly what landed (and where).
    const snapshot = (store.proposals as unknown as Proposal[]).find((p) => p.uri === uri);
    try {
      const ok = await review.approveProposal(uri);
      if (!ok) {
        lastError = 'Approve returned false — proposal may already be approved/rejected, or its payload has gone stale. Refresh to check.';
      } else {
        if (snapshot) lastSuccess = formatApplied(snapshot);
        selectedUri = null;
      }
    } catch (e) {
      lastError = `Approve failed: ${e instanceof Error ? e.message : String(e)}`;
      logger('proposal').error('approve failed:', e);
    } finally {
      // The approve path emits PROPOSALS_CHANGED (#1524) so the store re-lists
      // on its own; refresh directly too so the panel updates deterministically
      // without waiting on the broadcast round-trip.
      await store.refresh();
      processing = false;
    }
  }

  function formatApplied(p: Proposal): string {
    const summary = bundleEffectsSummary(p);
    const notes = (p.payloads ?? [])
      .filter((pl): pl is NotePayload => pl.kind === 'note')
      .map((pl) => pl.relativePath);
    if (notes.length > 0) {
      const head = notes.slice(0, 3).join(', ');
      const rest = notes.length > 3 ? ` (+${notes.length - 3} more)` : '';
      return `Approved — landed ${summary}. Notes: ${head}${rest}`;
    }
    return `Approved — landed ${summary}.`;
  }

  async function handleReject(uri: string) {
    processing = true;
    lastError = null;
    try {
      const ok = await review.rejectProposal(uri);
      if (!ok) {
        lastError = 'Reject returned false — proposal may already be resolved. Refresh to check.';
      } else {
        selectedUri = null;
      }
    } catch (e) {
      lastError = `Reject failed: ${e instanceof Error ? e.message : String(e)}`;
      logger('proposal').error('reject failed:', e);
    } finally {
      await store.refresh();
      processing = false;
    }
  }

  function togglePayload(uri: string, idx: number) {
    const key = `${uri}::${idx}`;
    const next = new Set(expandedPayloads);
    if (next.has(key)) next.delete(key); else next.add(key);
    expandedPayloads = next;
  }

  function payloadSummary(p: Payload): string {
    if (p.kind === 'note') {
      const np = p as NotePayload;
      return np.relativePath;
    }
    if (p.kind === 'graph-triples') {
      const tp = p as TriplesPayload;
      const types = countTypedSubjects(tp.turtle);
      if (types.size === 0) {
        return `${tp.affectsNodeUris.length} node${tp.affectsNodeUris.length === 1 ? '' : 's'}`;
      }
      return [...types.entries()]
        .map(([type, n]) => `${n} ${type}${n === 1 ? '' : 's'}`)
        .join(', ');
    }
    return p.kind;
  }

  /**
   * Count distinct rdf:type assignments in a Turtle blob, keyed by short type
   * name (e.g. "Claim" from `a thought:Claim`), so the preview reads "23 Claims"
   * rather than "23 triples affecting 23 nodes".
   */
  function countTypedSubjects(turtle: string): Map<string, number> {
    const out = new Map<string, number>();
    const re = /(?:^|\s|;)\s*(?:a|rdf:type)\s+(?:[a-zA-Z][\w-]*:)?([A-Za-z][\w-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(turtle)) !== null) {
      const t = m[1]!;
      out.set(t, (out.get(t) ?? 0) + 1);
    }
    return out;
  }

  /**
   * Bundle-level "what will this do" line, aggregated across all payloads so the
   * user sees at a glance whether they're approving notes, graph nodes, or both.
   */
  function bundleEffectsSummary(p: Proposal): string {
    let noteCount = 0;
    const types = new Map<string, number>();
    let unknownTriples = 0;
    for (const pl of p.payloads ?? []) {
      if (pl.kind === 'note') noteCount++;
      else if (pl.kind === 'graph-triples') {
        const c = countTypedSubjects((pl as TriplesPayload).turtle);
        if (c.size === 0) unknownTriples++;
        for (const [t, n] of c) types.set(t, (types.get(t) ?? 0) + n);
      }
    }
    const parts: string[] = [];
    if (noteCount > 0) parts.push(`${noteCount} note${noteCount === 1 ? '' : 's'}`);
    for (const [t, n] of types) parts.push(`${n} ${t}${n === 1 ? '' : 's'}`);
    if (unknownTriples > 0) parts.push(`${unknownTriples} triples block${unknownTriples === 1 ? '' : 's'}`);
    return parts.length === 0 ? 'no recognised payloads' : parts.join(', ');
  }

  function payloadPreview(p: Payload): string {
    if (p.kind === 'note') return (p as NotePayload).content;
    if (p.kind === 'graph-triples') return (p as TriplesPayload).turtle;
    return JSON.stringify(p, null, 2);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!selectedUri) return;
    if (e.key === 'y') { e.preventDefault(); void handleApprove(selectedUri); }
    if (e.key === 'n') { e.preventDefault(); void handleReject(selectedUri); }
    if (e.key === 's' || e.key === 'Escape') { e.preventDefault(); selectedUri = null; }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="proposals-panel" onkeydown={handleKeydown} tabindex="-1">
  <Ribbon
    {search}
    onSearch={(q: string) => { search = q; }}
    searchPlaceholder="Find proposal…"
    sortOptions={[
      { id: 'time', label: 'Newest first' },
      { id: 'type', label: 'By type' },
    ]}
    {sortId}
    onSort={(id: string) => { sortId = id as 'time' | 'type'; }}
  />
  <div class="status-tabs" role="tablist" aria-label="Filter proposals by status">
    {#each [
      { id: 'all',      label: 'All' },
      { id: 'pending',  label: 'Pending' },
      { id: 'approved', label: 'Approved' },
      { id: 'rejected', label: 'Rejected' },
    ] as tab}
      <button
        class="status-tab"
        class:active={statusFilter === tab.id}
        onclick={() => statusFilter = tab.id as typeof statusFilter}
        role="tab"
        aria-selected={statusFilter === tab.id}
      >{tab.label}</button>
    {/each}
  </div>
  {#if lastSuccess}
    <div class="success-banner" role="status">{lastSuccess}</div>
  {/if}
  {#if shown.length === 0}
    <p class="empty">{store.proposals.length === 0 ? 'No proposals' : 'No matches'}</p>
  {:else}
    <div class="proposal-list">
      {#each shown as p (p.uri)}
        {@const by = describeProposer(p.proposedBy)}
        <button
          class="proposal-item"
          class:selected={selectedUri === p.uri}
          onclick={() => selectedUri = selectedUri === p.uri ? null : p.uri}
        >
          <span class="proposal-meta">
            <span class="proposal-status status-{p.status}">{p.status}</span>
            <span class="proposal-type">{p.operationType.replace(/_/g, ' ')}</span>
            <span class="proposal-by" class:external={by.external} title={p.proposedBy}>
              {#if by.external}<span class="by-tag">agent</span>{/if}{by.label}
            </span>
          </span>
          <span class="proposal-note">{p.note}</span>
          <span class="proposal-effects" title="What approving this proposal will create">
            {p.status === 'pending' ? 'Will create' : 'Created'}: {bundleEffectsSummary(p)}
          </span>
        </button>

        {#if selectedUri === p.uri}
          <div class="proposal-detail">
            {#if (p.payloads?.length ?? 0) === 0}
              <div class="empty">No payloads on this proposal — nothing will land if you approve.</div>
            {:else}
              <ul class="payload-list">
                {#each p.payloads as payload, i}
                  <li>
                    <button
                      class="payload-row"
                      onclick={() => togglePayload(p.uri, i)}
                    >
                      <span class="payload-kind">{payload.kind}</span>
                      <span class="payload-summary">{payloadSummary(payload)}</span>
                      <span class="payload-toggle">{expandedPayloads.has(`${p.uri}::${i}`) ? '▾' : '▸'}</span>
                    </button>
                    {#if expandedPayloads.has(`${p.uri}::${i}`)}
                      <pre class="payload-preview">{payloadPreview(payload)}</pre>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if lastError}
              <div class="error-banner">{lastError}</div>
            {/if}
            <div class="proposal-actions">
              <button class="action-btn approve" onclick={() => handleApprove(p.uri)} disabled={processing || p.status !== 'pending'} title={p.status !== 'pending' ? `Already ${p.status}` : 'Approve and apply'}>
                Approve (y)
              </button>
              <button class="action-btn reject" onclick={() => handleReject(p.uri)} disabled={processing || p.status !== 'pending'} title={p.status !== 'pending' ? `Already ${p.status}` : 'Reject without applying'}>
                Reject (n)
              </button>
              <button
                class="action-btn skip"
                onclick={() => selectedUri = null}
                title="Collapse this proposal's detail view (no state change)"
              >Close (s)</button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .proposals-panel {
    padding: 8px;
    overflow-y: auto;
    flex: 1;
    outline: none;
  }

  /* Filter chips (§13.8) — pill row instead of bordered rectangles. */
  .status-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .status-tab {
    padding: 3px 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 11.5px;
    cursor: pointer;
    border-radius: 999px;
  }
  .status-tab:hover:not(.active) { color: var(--text); }
  .status-tab.active {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 30%, transparent);
    background: color-mix(in oklch, var(--accent) 14%, transparent);
  }
  .empty {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    padding: 16px 0;
  }

  .proposal-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Proposal card (§13.8) — softer shell with the status pill at the top in
     mono-uppercase, accent-tinted for pending / sage for approved / muted for
     rejected. */
  .proposal-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    cursor: pointer;
    text-align: left;
    width: 100%;
    font-family: var(--font-sans);
  }

  .proposal-item:hover { background: color-mix(in oklch, var(--text) 4%, transparent); }
  .proposal-item.selected {
    border-color: color-mix(in oklch, var(--accent) 40%, transparent);
    background: color-mix(in oklch, var(--accent) 8%, transparent);
  }

  .proposal-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
  }
  .proposal-status {
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border: 1px solid transparent;
  }
  .proposal-status.status-pending {
    color: var(--accent);
    background: color-mix(in oklch, var(--accent) 18%, transparent);
  }
  .proposal-status.status-approved {
    color: var(--sage);
    background: color-mix(in oklch, var(--sage) 18%, transparent);
  }
  .proposal-status.status-rejected,
  .proposal-status.status-expired {
    color: var(--text-faint);
    background: color-mix(in oklch, var(--text) 6%, transparent);
  }
  .proposal-type {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    text-transform: lowercase;
  }
  .proposal-by {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    /* --text-muted, not --text-faint: the byline sits on the selected item's
       tinted background where --text-faint falls to 3.9:1 (below WCAG AA);
       --text-muted clears 4.5:1 there (#1104). */
    color: var(--text-muted);
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A contribution from a fleet agent (MCP client / CLI), not Minerva's own AI —
     surfaced so the reviewer sees at a glance who proposed it (#1151). */
  .proposal-by.external {
    color: var(--accent);
  }
  .by-tag {
    font-family: var(--font-sans, inherit);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--bg-button, var(--bg-elev));
    color: var(--accent);
    border: 1px solid var(--accent);
  }

  .proposal-note {
    font-size: 12.5px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .proposal-effects {
    font-size: 11px;
    color: var(--text-muted);
  }

  .proposal-detail {
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .payload-list {
    list-style: none;
    padding: 4px 0;
    margin: 0;
    max-height: 320px;
    overflow-y: auto;
  }
  .payload-row {
    width: 100%;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 8px;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .payload-row:hover { background: var(--bg-button); }
  .payload-kind {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-muted);
    min-width: 90px;
  }
  .payload-summary {
    font-family: var(--font-mono);
    font-size: 11px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .payload-toggle {
    color: var(--text-muted);
  }
  .payload-preview {
    margin: 4px 8px 8px 8px;
    padding: 6px 8px;
    background: var(--bg-code, var(--bg-titlebar));
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 280px;
    overflow-y: auto;
  }
  .empty {
    padding: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .error-banner {
    margin: 4px 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
  }
  .success-banner {
    margin: 0 0 8px 0;
    padding: 6px 8px;
    border: 1px solid var(--accent);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
  }

  .proposal-actions {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
  }

  /* Approve = accent CTA. Reject = ghost outline (no danger styling per
     CLAUDE.md — reject is just a normal action). */
  .action-btn {
    flex: 1;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 11.5px;
    cursor: pointer;
  }
  .action-btn:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .action-btn:disabled { opacity: 0.4; cursor: default; }
  .action-btn.approve {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 600;
  }
  .action-btn.approve:hover:not(:disabled) {
    opacity: 0.92;
    color: var(--accent-ink);
  }
</style>
