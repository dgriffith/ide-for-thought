<script lang="ts">
  /**
   * The graph as a table (#2960): each of the view's notes with the notes it
   * links to and the notes that link to it, each link with its kind. The
   * graph's accessible equivalent.
   */
  import type { GraphViewModel } from '../../../src/shared/objects/graph-view';

  interface Props {
    model: GraphViewModel;
    onOpen?: (path: string, outside: boolean) => void;
  }
  let { model, onOpen }: Props = $props();

  const label = $derived(new Map(model.nodes.map((n) => [n.id, n] as const)));
  const kindLabel = $derived(new Map(model.kinds.map((k) => [k.property, k.label] as const)));
  const rows = $derived(model.nodes.filter((n) => !n.outside).map((n) => ({
    node: n,
    out: model.edges.filter((e) => e.source === n.id),
    in: model.edges.filter((e) => e.target === n.id),
  })));

</script>

<table class="gv-table">
  <thead>
    <tr>
      <th scope="col">Note</th>
      <th scope="col">Links to</th>
      <th scope="col">Linked from</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as r (r.node.id)}
      <tr>
        <th scope="row">
          {#if onOpen}
            <button type="button" class="gv-open" onclick={() => onOpen(r.node.id, false)}>{r.node.label}</button>
          {:else}{r.node.label}{/if}
          {#if r.node.typeLabel}<span class="gv-type"> · {r.node.typeLabel}</span>{/if}
        </th>
        {#each [{ list: r.out, end: 'target' }, { list: r.in, end: 'source' }] as col (col.end)}
          <td>
            {#if col.list.length === 0}<span class="gv-none">—</span>{/if}
            {#each col.list as e (`${e.source}\u0000${e.target}\u0000${e.property}`)}
              {@const other = col.end === 'target' ? e.target : e.source}
              {@const n = label.get(other)}
              <div class="gv-link">
                <span class="gv-kind">{kindLabel.get(e.property) ?? e.property}:</span>
                {#if onOpen}
                  <button type="button" class="gv-open" onclick={() => onOpen(other, n?.outside ?? false)}>{n?.label ?? other}</button>
                {:else}{n?.label ?? other}{/if}
                {#if n?.outside}<span class="gv-outside"> (not in this view)</span>{/if}
              </div>
            {/each}
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .gv-table { border-collapse: collapse; width: 100%; }
  .gv-table th, .gv-table td { border-bottom: 1px solid var(--border); padding: 5px 10px; text-align: left; vertical-align: top; font-weight: normal; }
  .gv-table thead th { color: var(--text-muted); font-size: 12px; position: sticky; top: 0; background: var(--bg); }
  .gv-open { font: inherit; color: var(--text); background: none; border: none; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 2px; }
  .gv-open:hover, .gv-open:focus-visible { color: var(--accent-ink); }
  .gv-type, .gv-kind, .gv-outside, .gv-none { color: var(--text-muted); }
</style>
