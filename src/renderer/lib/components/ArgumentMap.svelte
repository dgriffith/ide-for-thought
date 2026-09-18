<script lang="ts">
  /**
   * The `:::argument` embed (#907) — a claim's Toulmin support/attack
   * structure, rendered inline in the prose that argues it.
   *
   * Mounted (not markdown-rendered to an HTML string) because it needs real
   * interactive state — the outline/diagram toggle and the depth stepper —
   * matching the precedent `object-view-renderer.ts` set for `TypeView` (see
   * `argument-map-renderer.ts`). Read-only: the only IPC call anywhere in
   * this component is `api.graph.query` — never a write path.
   *
   * Query strategy: N sequential 1-hop queries (one per depth level, capped
   * at `MAX_DEPTH`), not a SPARQL property path — see the module doc on
   * `argument-map-query.ts` for why. All `MAX_DEPTH` hops are fetched once on
   * mount; the depth stepper then just filters the already-fetched node set
   * client-side (`filterByDepth`) — instant, no re-query.
   *
   * On most real thoughtbases today this will render the empty state. Almost
   * nothing files formally-typed Grounds/Warrant/Rebuttal/Defect nodes yet —
   * the two skills that author argument-relevant edges today
   * (`find-supporting-arguments.md`, `crystallize.md`) both do it via plain
   * frontmatter/embedded-turtle relations on ordinary notes, not through a
   * dedicated component-authoring tool. That's expected, not a bug — this
   * embed is the legibility layer for structure other tooling will
   * increasingly produce, not the thing that produces it (see #907).
   */
  import { api } from '../ipc/client';
  import { hydrateMermaidBlocks } from '../markdown/mermaid-renderer';
  import { logger } from '../../../shared/logger';
  import {
    MAX_DEPTH,
    parseFocusRef,
    buildFocusQuery,
    buildHopQuery,
    buildDefectsQuery,
    foldHopRows,
    filterByDepth,
    groupByKind,
    parseDefectRows,
    buildArgumentMermaid,
    labelFor,
    type ArgumentNode,
    type ArgumentDefect,
    type HopRow,
    type DefectRow,
    type RelationKind,
  } from '../preview/argument-map-query';

  interface Props {
    /** Raw directive body from the `:::argument` block — a wiki-link, e.g.
     *  `"[[Some Claim]]"`, not yet extracted to a bare target (`parseFocusRef`
     *  does that inside `load()` below). */
    focusRef: string;
    queryPrefixes: string;
    resolvePath: (target: string) => string | null;
    onNavigate: (relativePath: string) => void;
    initialDepth?: number;
    initialView?: 'outline' | 'diagram';
  }

  let { focusRef, queryPrefixes, resolvePath, onNavigate, initialDepth, initialView }: Props = $props();

  type Status = 'loading' | 'unresolved' | 'error' | 'ready';
  let status = $state<Status>('loading');
  let errorMessage = $state('');
  let focusUri = $state<string | null>(null);
  let focusLabel = $state('');
  let allNodes = $state<ArgumentNode[]>([]);
  let defects = $state<ArgumentDefect[]>([]);

  const clampedInitialDepth = Math.min(Math.max(initialDepth ?? 2, 1), MAX_DEPTH);
  let depth = $state(clampedInitialDepth);
  let view = $state<'outline' | 'diagram'>(initialView === 'diagram' ? 'diagram' : 'outline');

  const visibleNodes = $derived(filterByDepth(allNodes, depth));
  const grouped = $derived(groupByKind(visibleNodes));
  const isEmpty = $derived(status === 'ready' && visibleNodes.length === 0 && defects.length === 0);

  async function load(): Promise<void> {
    status = 'loading';
    const target = parseFocusRef(focusRef);
    const resolved = target ? resolvePath(target) : null;
    if (!resolved) {
      status = 'unresolved';
      return;
    }
    try {
      const focusResp = await api.graph.query(queryPrefixes + buildFocusQuery(resolved));
      if (focusResp.error) { status = 'error'; errorMessage = focusResp.error; return; }
      const focusRow = (focusResp.results as { focus?: string; title?: string; label?: string }[])[0];
      if (!focusRow?.focus) { status = 'unresolved'; return; }

      focusUri = focusRow.focus;
      focusLabel = labelFor(focusRow, resolved.split('/').pop() ?? resolved);

      const known = new Set<string>([focusUri]);
      let frontier = [focusUri];
      const nodes: ArgumentNode[] = [];
      for (let hop = 1; hop <= MAX_DEPTH && frontier.length > 0; hop++) {
        const resp = await api.graph.query(queryPrefixes + buildHopQuery(frontier));
        if (resp.error) {
          // Partial structure is still useful — don't discard what loaded.
          logger('preview').warn('argument-map hop query failed:', resp.error);
          break;
        }
        const hopNodes = foldHopRows(resp.results as HopRow[], hop, known);
        for (const n of hopNodes) known.add(n.uri);
        nodes.push(...hopNodes);
        frontier = hopNodes.map((n) => n.uri);
      }
      allNodes = nodes;

      const notePaths = [resolved, ...nodes.map((n) => n.notePath).filter((p): p is string => !!p)];
      const defectsQuery = buildDefectsQuery(notePaths);
      if (defectsQuery) {
        const defResp = await api.graph.query(queryPrefixes + defectsQuery);
        defects = defResp.error ? [] : parseDefectRows(defResp.results as DefectRow[]);
      }
      status = 'ready';
    } catch (e) {
      status = 'error';
      errorMessage = e instanceof Error ? e.message : String(e);
      logger('preview').warn('argument-map load failed:', e);
    }
  }

  $effect(() => { void load(); });

  let mermaidHost = $state<HTMLDivElement>();
  $effect(() => {
    if (view !== 'diagram' || status !== 'ready' || !mermaidHost || !focusUri) return;
    const source = buildArgumentMermaid(focusUri, focusLabel, visibleNodes);
    mermaidHost.classList.add('mermaid-block');
    mermaidHost.dataset.mermaidSource = source;
    mermaidHost.removeAttribute('data-mermaid-rendered');
    // hydrateMermaidBlocks looks at DESCENDANTS of the element it's given —
    // it never matches the root itself — so hand it the host's parent.
    if (mermaidHost.parentElement) void hydrateMermaidBlocks(mermaidHost.parentElement);
  });

  const KIND_LABEL: Record<RelationKind, string> = {
    support: 'Support', attack: 'Attack', qualify: 'Qualifiers', other: 'Other',
  };
  const KIND_ORDER: RelationKind[] = ['support', 'attack', 'qualify', 'other'];
</script>

<div class="argument-map">
  {#if status === 'loading'}
    <p class="query-loading">Loading argument structure…</p>
  {:else if status === 'unresolved'}
    <p class="query-error">Can't find a note for "{focusRef}".</p>
  {:else if status === 'error'}
    <p class="query-error">{errorMessage}</p>
  {:else}
    <div class="argument-map-header">
      <span class="argument-map-focus">{focusLabel}</span>
      <div class="argument-map-controls">
        <div class="view-toggle">
          <button type="button" class:active={view === 'outline'} onclick={() => { view = 'outline'; }}>Outline</button>
          <button type="button" class:active={view === 'diagram'} onclick={() => { view = 'diagram'; }}>Diagram</button>
        </div>
        <label class="depth-control">
          Depth
          <input
            type="range"
            min="1"
            max={MAX_DEPTH}
            bind:value={depth}
          />
          <span>{depth}</span>
        </label>
      </div>
    </div>

    {#if isEmpty}
      <p class="query-empty">No argument structure recorded for this claim yet.</p>
    {:else if view === 'outline'}
      <div class="argument-outline">
        {#each KIND_ORDER as kind (kind)}
          {#if grouped[kind].length > 0}
            <div class="argument-group argument-group-{kind}">
              <h4>{KIND_LABEL[kind]}</h4>
              <ul>
                {#each grouped[kind] as node (node.uri)}
                  <li>
                    {#if node.roleType}<span class="role-type">{node.roleType}:</span>{/if}
                    {#if node.notePath}
                      <button type="button" class="node-link" onclick={() => onNavigate(node.notePath!)}>{node.label}</button>
                    {:else}
                      <span>{node.label}</span>
                    {/if}
                    <span class="relation-name">({node.relation})</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <div bind:this={mermaidHost}></div>
    {/if}

    {#if defects.length > 0}
      <div class="argument-defects">
        <h4>⚠ Defects noted in {defects.length === 1 ? 'this note' : 'these notes'}</h4>
        <ul>
          {#each defects as d (d.uri)}
            <li>{d.label}</li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</div>

<style>
  .argument-map {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    margin: 8px 0;
    background: var(--bg-elev);
  }
  .argument-map-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .argument-map-focus {
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }
  .argument-map-controls {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .view-toggle {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .view-toggle button {
    background: none;
    border: none;
    padding: 3px 8px;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .view-toggle button.active {
    background: var(--bg-button);
    color: var(--text);
  }
  .depth-control {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .argument-group {
    margin-bottom: 8px;
  }
  .argument-group h4 {
    margin: 0 0 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--text-muted);
  }
  .argument-group-support h4 { color: var(--sage); }
  .argument-group-attack h4 { color: var(--rust); }
  .argument-group-qualify h4 { color: var(--hl-yellow); }
  .argument-group ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .argument-group li {
    font-size: 12.5px;
    color: var(--text);
  }
  .role-type {
    color: var(--text-muted);
    font-size: 11px;
    margin-right: 3px;
  }
  .relation-name {
    color: var(--text-faint);
    font-size: 10.5px;
    margin-left: 4px;
  }
  .node-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
    text-decoration: none;
  }
  .node-link:hover {
    text-decoration: underline;
  }
  .argument-defects {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .argument-defects h4 {
    margin: 0 0 4px;
    font-size: 11px;
    color: var(--rust);
  }
  .argument-defects ul {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
