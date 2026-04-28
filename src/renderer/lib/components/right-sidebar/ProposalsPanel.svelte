<script lang="ts">
  import { api } from '../../ipc/client';
  import { onMount } from 'svelte';
  import Ribbon from './Ribbon.svelte';

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

  interface Props {
    revision: number;
  }

  let { revision }: Props = $props();

  let proposals = $state<Proposal[]>([]);
  let selectedUri = $state<string | null>(null);
  let expandedPayloads = $state<Set<string>>(new Set());
  let processing = $state(false);
  let lastError = $state<string | null>(null);
  let lastSuccess = $state<string | null>(null);
  let search = $state('');
  let sortId = $state<'time' | 'type'>('time');
  // Most flows are auto-approve (inline draft cards) so by default a user
  // wouldn't see anything in this panel — defaulting to "all" makes the
  // audit trail visible. Pending stays a one-click toggle for triage mode.
  let statusFilter = $state<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const shown = $derived(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? proposals.filter((p) =>
          p.note.toLowerCase().includes(q) ||
          p.operationType.toLowerCase().includes(q) ||
          p.proposedBy.toLowerCase().includes(q)
        )
      : proposals;
    if (sortId === 'type') {
      return [...filtered].sort((a, b) => a.operationType.localeCompare(b.operationType));
    }
    // Newest first — matches what a reviewer reaches for when new
    // proposals land while older ones sit waiting.
    return [...filtered].sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
  });

  async function refresh() {
    const result = statusFilter === 'all'
      ? await api.proposals.list()
      : await api.proposals.list(statusFilter);
    proposals = result as Proposal[];
  }

  $effect(() => {
    statusFilter; // reactive trigger
    void refresh();
  });

  onMount(() => { void refresh(); });

  $effect(() => {
    revision;
    void refresh();
  });

  async function handleApprove(uri: string) {
    processing = true;
    lastError = null;
    lastSuccess = null;
    // Snapshot the proposal's payload summary BEFORE approve flips status —
    // that lets the success banner say exactly what landed (and where).
    const snapshot = proposals.find((p) => p.uri === uri);
    try {
      const ok = await api.proposals.approve(uri);
      if (!ok) {
        lastError = 'Approve returned false — proposal may already be approved/rejected, or its payload has gone stale. Refresh to check.';
      } else {
        if (snapshot) lastSuccess = formatApplied(snapshot);
        selectedUri = null;
      }
    } catch (e) {
      lastError = `Approve failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[proposal] approve failed:', e);
    } finally {
      await refresh();
      processing = false;
    }
  }

  function formatApplied(p: Proposal): string {
    // Aggregate the same way bundleEffectsSummary does (so before/after
    // text matches), and inline the first few note paths so the user can
    // jump to them.
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
      const ok = await api.proposals.reject(uri);
      if (!ok) {
        lastError = 'Reject returned false — proposal may already be resolved. Refresh to check.';
      } else {
        selectedUri = null;
      }
    } catch (e) {
      lastError = `Reject failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[proposal] reject failed:', e);
    } finally {
      await refresh();
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
   * Count distinct rdf:type assignments in a Turtle blob, keyed by short
   * type name (e.g. "Claim" from `a thought:Claim`). Used to give the
   * proposal preview a real-language summary — "23 Claims" rather than
   * "23 triples affecting 23 nodes" — so the user doesn't mistake graph
   * components for files-on-disk.
   */
  function countTypedSubjects(turtle: string): Map<string, number> {
    const out = new Map<string, number>();
    // `a thought:X`, `a minerva:Y`, `rdf:type thought:Z`. Captures the local
    // name after the prefix; falls back to the full prefixed form.
    const re = /(?:^|\s|;)\s*(?:a|rdf:type)\s+(?:[a-zA-Z][\w-]*:)?([A-Za-z][\w-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(turtle)) !== null) {
      const t = m[1];
      out.set(t, (out.get(t) ?? 0) + 1);
    }
    return out;
  }

  /**
   * Bundle-level "what will this do" line: aggregates across all payloads
   * so the user can see at a glance whether they're approving notes,
   * graph nodes, or both. Mirrors formatApplied (post-approve banner).
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
  {#if shown().length === 0}
    <p class="empty">{proposals.length === 0 ? 'No pending proposals' : 'No matches'}</p>
  {:else}
    <div class="proposal-list">
      {#each shown() as p}
        <button
          class="proposal-item"
          class:selected={selectedUri === p.uri}
          onclick={() => selectedUri = selectedUri === p.uri ? null : p.uri}
        >
          <span class="proposal-type">{p.operationType.replace(/_/g, ' ')}</span>
          <span class="proposal-note">{p.note}</span>
          <span class="proposal-effects" title="What approving this proposal will create">
            {p.status === 'pending' ? 'Will create' : 'Created'}: {bundleEffectsSummary(p)}
          </span>
          <span class="proposal-meta">
            <span class="proposal-status status-{p.status}">{p.status}</span>
            <span class="proposal-by">{p.proposedBy}</span>
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

  .status-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 8px;
  }
  .status-tab {
    flex: 1;
    padding: 4px 6px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    border-radius: 3px;
  }
  .status-tab:hover { color: var(--text); }
  .status-tab.active {
    color: var(--text);
    border-color: var(--accent);
    background: var(--bg-button);
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

  .proposal-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .proposal-item:hover { background: var(--bg-button); }
  .proposal-item.selected { border-color: var(--accent); background: var(--bg-button); }

  .proposal-type {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
  }

  .proposal-note {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .proposal-effects {
    font-size: 11px;
    color: var(--accent);
  }
  .proposal-meta {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: var(--text-muted);
  }
  .proposal-by {
    font-size: 10px;
    color: var(--text-muted);
  }
  .proposal-status {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .proposal-status.status-approved { color: var(--accent); border-color: var(--accent); }
  .proposal-status.status-pending { color: var(--text); }
  .proposal-status.status-rejected,
  .proposal-status.status-expired { color: var(--text-muted); }

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
    font-family: 'SF Mono', 'Fira Code', monospace;
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
    font-family: 'SF Mono', 'Fira Code', monospace;
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

  .action-btn {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
  }

  .action-btn:hover { background: var(--bg-button-hover); }
  .action-btn:disabled { opacity: 0.4; cursor: default; }
  .action-btn.approve { border-color: var(--accent); }
</style>
