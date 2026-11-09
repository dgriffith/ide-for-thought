<script lang="ts">
  /**
   * The Mindmap layout (#2966): a type's notes as a hierarchy, by a property
   * that links to the type's own notes (a task's `parent`). The view is the
   * root; the notes with no parent in it its branches; each note under its
   * parent, in the view's order (`shared/mindmap/view-hierarchy.ts`).
   *
   * It's a layout like any other: the view's filters and sort, a click to its
   * selection (⌘ toggles, ⇧ extends, a plain click opens), right-click for the
   * note menu, Enter or a double-click to open.
   *
   * In a tab (not an embed) it edits, each change the app's own
   * (`lib/app/mindmap-notes.ts`): Tab / Enter make a new note under a node or
   * beside it (asking its title, the type's template applied); a drag, ⌘[ or
   * ⌘] moves a note to another parent — one property, undone with ⌘Z;
   * F2 renames the note. Deleting is the sidebar's.
   *
   * Which parent property it follows (when the type has more than one), its
   * shape and its folds are kept per type on this machine.
   */
  import Mindmap from '../mindmap/Mindmap.svelte';
  import type { MindmapEdits } from '../mindmap/mindmap-edits';
  import { mindmapDisplayTree } from '../mindmap/mindmap-display';
  import type { LayoutView } from './layout-view';
  import { objectTypesStore } from '../../stores/object-types.svelte';
  import { announce } from '../../stores/announcer.svelte';
  import { viewHierarchy, VIEW_ROOT_ID } from '../../../../shared/mindmap/view-hierarchy';
  import type { MindmapNoteTree } from '../../../../shared/mindmap/note-hierarchy';
  import { inheritsFrom } from '../../../../shared/objects/inheritance';
  import { createChildNote, renameNoteTo, reparentNotes, undoReparent, type NoteRef } from '../../app/mindmap-notes';
  import { layoutMindmap } from '../../../../shared/mindmap/mindmap-layout';
  import { mindmapSvg, MINDMAP_EXPORT_COLORS } from '../../../../shared/mindmap/mindmap-svg';

  let { view }: { view: LayoutView } = $props();

  // Properties that link a note of this type to another of it: the hierarchies it can draw.
  const parentProps = $derived.by(() => {
    const byId = new Map(objectTypesStore.types.map((t) => [t.id, t] as const));
    return view.properties.filter((p) => p.type === 'link-to-type' && !!p.targetType && (p.targetType === view.type.id || inheritsFrom(view.type.id, p.targetType, byId)));
  });

  // Kept per type, on this machine.
  const key = $derived(`minerva.mindmap-view:${view.type.id}`);
  function read(): { parentBy: string | null; shape: 'ltr' | 'radial'; folded: string[] } {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, unknown> | null;
      return {
        parentBy: typeof raw?.parentBy === 'string' ? raw.parentBy : null,
        shape: raw?.shape === 'radial' ? 'radial' : 'ltr',
        folded: Array.isArray(raw?.folded) ? raw.folded.filter((f): f is string => typeof f === 'string') : [],
      };
    } catch { return { parentBy: null, shape: 'ltr', folded: [] }; }
  }
  let kept = $state(read());
  $effect(() => { void key; kept = read(); });
  function keep(next: typeof kept): void {
    kept = next;
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* a private window: not kept */ }
  }

  const parentProp = $derived(parentProps.find((p) => p.name === kept.parentBy) ?? parentProps[0] ?? null);
  const notes = $derived(view.sorted.filter((i) => !i.noNote).map((i) => ({
    path: i.path, title: i.title,
    parent: parentProp ? view.linkPath(parentProp, i.values[parentProp.name] ?? null) : null,
  })));
  const tree = $derived(viewHierarchy(notes, view.type.label));
  const display = $derived(mindmapDisplayTree(tree));
  const marked = $derived(new Set(notes.filter((n) => view.isSelected(n.path)).map((n) => n.path)));
  const parentOf = $derived(new Map(notes.map((n) => [n.path, n] as const)));

  const ref = (path: string): NoteRef | null => {
    const n = parentOf.get(path);
    return n ? { path: n.path, title: n.title } : null;
  };
  /** The parent a node is drawn under: null at the top. */
  const drawnParent = (path: string): string | null => {
    let found: string | null = null;
    const walk = (t: MindmapNoteTree, parent: string | null) => { if (t.id === path) found = parent; t.children.forEach((c) => walk(c, t.id === VIEW_ROOT_ID ? null : t.id)); };
    walk(tree, null);
    return found;
  };
  /** The notes drawn directly under a node (null: the top), in order. */
  const drawnChildren = (parent: string | null): string[] => {
    let found: string[] = [];
    const walk = (t: MindmapNoteTree) => { if (t.id === (parent ?? VIEW_ROOT_ID)) found = t.children.map((c) => c.id); else t.children.forEach(walk); };
    walk(tree);
    return found;
  };
  const isUnder = (path: string, ancestor: string): boolean => {
    for (let p: string | null = path; p; p = drawnParent(p)) if (p === ancestor) return true;
    return false;
  };
  /** The notes a move carries: the selection, when the note moved is in it; else just it. */
  const carried = (path: string): NoteRef[] =>
    (marked.has(path) ? [...marked] : [path]).map(ref).filter((r): r is NoteRef => r !== null);

  async function moveUnder(path: string, parent: string | null): Promise<string | null> {
    if (!parentProp) return null;
    const notesToMove = carried(path);
    if (parent !== null && notesToMove.some((n) => isUnder(parent, n.path))) { announce('A note can’t go under itself.'); return null; }
    await reparentNotes(notesToMove, parentProp.name, parent ? ref(parent) : null);
    return path;
  }

  const exportSvg = $derived(view.exportMode
    ? mindmapSvg(layoutMindmap(display, { orientation: kept.shape, folded: new Set(kept.folded) }), MINDMAP_EXPORT_COLORS, { title: `${view.type.label} by ${parentProp?.label ?? parentProp?.name ?? ''}` })
        .replace('<svg ', '<svg style="max-width: 100%; height: auto;" ')
    : '');

  const edits = $derived<MindmapEdits | undefined>(view.readOnly || !parentProp ? undefined : {
    namesItself: true,
    addChild: (id) => createChildNote({ type: view.type, catalog: objectTypesStore.types, parentProperty: parentProp.name, parent: id === VIEW_ROOT_ID ? null : ref(id) }),
    addSibling: (id) => {
      const parent = drawnParent(id);
      return createChildNote({ type: view.type, catalog: objectTypesStore.types, parentProperty: parentProp.name, parent: parent ? ref(parent) : null });
    },
    rename: (id, text) => renameNoteTo(id, text),
    remove: () => { announce('Delete a note from the Notes sidebar; the map only moves and makes notes.'); return false; },
    drop: (id, target, where) => moveUnder(id, where === 'child' ? (target === VIEW_ROOT_ID ? null : target) : drawnParent(target)),
    promote: (id) => {
      const parent = drawnParent(id);
      if (!parent) { announce('It’s already at the top.'); return null; }
      return moveUnder(id, drawnParent(parent));
    },
    demote: (id) => {
      const siblings = drawnChildren(drawnParent(id));
      const before = siblings[siblings.indexOf(id) - 1] ?? null;
      if (!before) { announce('There’s nothing before it to go under.'); return null; }
      return moveUnder(id, before);
    },
    undo: () => { void undoReparent(); },
    redo: () => announce('Moves on the map can be undone, not redone.'),
  });
</script>

<div class="mm-layout">
  {#if !view.exportMode}
  <div class="mm-bar">
    {#if parentProps.length > 1}
      <label class="mm-by">Branches by
        <select value={parentProp?.name} onchange={(e) => keep({ ...kept, parentBy: e.currentTarget.value })}>
          {#each parentProps as p (p.name)}<option value={p.name}>{p.label ?? p.name}</option>{/each}
        </select>
      </label>
    {/if}
    <span class="mm-shape" role="group" aria-label="Map layout">
      <button type="button" aria-pressed={kept.shape === 'ltr'} onclick={() => keep({ ...kept, shape: 'ltr' })}>Left to right</button>
      <button type="button" aria-pressed={kept.shape === 'radial'} onclick={() => keep({ ...kept, shape: 'radial' })}>Radial</button>
    </span>
  </div>
  {/if}
  {#if view.exportMode && parentProp}
    <!-- An export (#2967): the map as a still SVG in the export's colours, folded as it's left here. -->
    <div class="mm-export">{@html exportSvg}</div>
  {:else if !parentProp}
    <p class="mm-none">A mindmap needs a property that links a {view.type.label} to another one, like a parent.</p>
  {:else}
    <div class="mm-canvas">
      <Mindmap
        tree={display}
        orientation={kept.shape}
        folded={kept.folded}
        onFold={(id, f) => keep({ ...kept, folded: f ? [...kept.folded, id] : kept.folded.filter((x) => x !== id) })}
        {marked}
        onSelect={(id, e) => { if (id !== VIEW_ROOT_ID) view.onRowClick(e ?? new MouseEvent('click'), id); }}
        onContextMenu={view.rowMenu ? (id, e) => { if (id !== VIEW_ROOT_ID) view.onRowContextMenu(e, id); } : undefined}
        onActivate={(id) => { if (id !== VIEW_ROOT_ID) view.onOpenNote(id); }}
        label={`${view.type.label} by ${parentProp.label ?? parentProp.name}`}
        edit={edits}
      />
    </div>
  {/if}
</div>

<style>
  .mm-layout { display: flex; flex-direction: column; height: 100%; min-height: 360px; }
  .mm-bar { display: flex; align-items: center; gap: 10px; padding: 4px 8px; font-size: 12px; color: var(--text-muted); }
  .mm-shape { display: inline-flex; gap: 4px; }
  .mm-shape button { font: inherit; color: var(--text); background: var(--bg-button); border: 1px solid var(--border); border-radius: 4px; padding: 1px 8px; cursor: pointer; }
  .mm-shape button[aria-pressed='true'] { border-color: var(--accent); }
  .mm-canvas { flex: 1; min-height: 320px; position: relative; }
  .mm-none { color: var(--text-muted); padding: 12px; }
</style>
