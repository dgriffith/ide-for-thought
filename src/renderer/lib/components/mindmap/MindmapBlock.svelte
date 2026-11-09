<script lang="ts">
  /**
   * A `:::mindmap` block in a note's preview (#2966): a hierarchy of notes out
   * from a focus, drawn read-only by the Mindmap component. Its tree comes
   * from main's walk (`graph:mindmap`) along the relation the block names —
   * or, for `headings`, from the focus note's own outline. Opening a node
   * opens its note. A note drawn in several places, a cycle, and children past
   * the depth say so on the node.
   */
  import Mindmap from './Mindmap.svelte';
  import { api } from '../../ipc/client';
  import { parseOutline, type OutlineNode } from '../../../../shared/outline/outline';
  import type { MindmapBlockSpec, MindmapNoteTree } from '../../../../shared/mindmap/note-hierarchy';
  import { mindmapDisplayTree } from './mindmap-display';

  interface Props {
    spec: MindmapBlockSpec;
    /** The focus link's note, or null when it names none. */
    focusPath: string | null;
    onNavigate: (path: string) => void;
  }
  let { spec, focusPath, onNavigate }: Props = $props();

  let tree = $state<MindmapNoteTree | null>(null);
  let problem = $state<string | null>(null);
  let truncated = $state(false);
  let folded = $state<string[]>([]);

  /** The focus note's outline as a tree: its title the root, headings and list items the branches. */
  function outlineTree(path: string, text: string): MindmapNoteTree {
    const o = parseOutline(text);
    const build = (n: OutlineNode, id: string): MindmapNoteTree => ({
      id, label: n.kind === 'root' ? path.replace(/^.*\//, '').replace(/\.md$/, '') : n.text, path: n.kind === 'root' ? path : null,
      children: n.children.map((c, i) => build(c, `${id}\u001f${i}`)),
    });
    return build(o.root, path);
  }

  $effect(() => {
    const path = focusPath;
    const s = spec;
    tree = null;
    problem = null;
    if (!s.focus) { problem = 'A :::mindmap block needs a focus note, as a [[link]] on a line of its own.'; return; }
    if (!path) { problem = `No note is called “${s.focus}”.`; return; }
    const load = s.relation === 'headings'
      ? api.notebase.readFile(path).then((text) => ({ tree: outlineTree(path, text), truncated: false }))
      : api.graph.mindmap(path, { relation: s.relation, direction: s.direction, depth: s.depth });
    void load.then((r) => { tree = r.tree; truncated = r.truncated; }, (e: unknown) => { problem = `The map couldn't be drawn: ${e instanceof Error ? e.message : String(e)}`; });
  });

  const display = $derived(tree ? mindmapDisplayTree(tree) : null);
  const pathOf = $derived.by(() => {
    const m = new Map<string, string>();
    const walk = (n: MindmapNoteTree) => { if (n.path) m.set(n.id, n.path); n.children.forEach(walk); };
    if (tree) walk(tree);
    return m;
  });
</script>

<div class="mindmap-block-view">
  {#if problem}
    <p class="query-error">{problem}</p>
  {:else if display}
    {#if display.children.length === 0}
      <p class="mm-empty">Nothing is joined to “{display.label}” by {spec.relation === 'headings' ? 'headings or list items' : `“${spec.relation}”`}.</p>
    {:else}
      <div class="mm-frame">
        <Mindmap
          tree={display}
          orientation={spec.layout}
          {folded}
          onFold={(id, f) => (folded = f ? [...folded, id] : folded.filter((x) => x !== id))}
          onActivate={(id) => { const p = pathOf.get(id); if (p) onNavigate(p); }}
          label={`Mindmap of ${display.label}`}
        />
      </div>
      {#if truncated}<p class="mm-note">Only the first nodes are drawn: the hierarchy is larger.</p>{/if}
    {/if}
  {/if}
</div>

<style>
  .mm-frame { height: 360px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .mm-empty, .mm-note { color: var(--text-muted); font-size: 13px; }
</style>
