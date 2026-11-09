<script lang="ts">
  /**
   * A note as a mindmap (#2965): the Mindmap view mode. The map is the note's
   * outline (`shared/outline/outline.ts`) — its title the root, its headings
   * and list items the branches — computed from the text every time.
   *
   * Every edit is a text edit to the note (`shared/outline/outline-edits.ts`),
   * dispatched on the note's own editor view — mounted, hidden, in the
   * Mindmap-only mode — so ⌘Z undoes it, in the map or the editor, and the
   * note is dirty as after any edit. An edit that can't be made is said.
   *
   * Beside the editor (Side by side), the two follow each other: selecting a
   * node puts the editor's cursor on its line; moving the cursor selects the
   * node it's in.
   *
   * The fold state and the map's orientation are kept per note, on this
   * machine, never in the note.
   */
  import type { EditorView } from '@codemirror/view';
  import { ChangeSet } from '@codemirror/state';
  import { undo, redo } from '@codemirror/commands';
  import Mindmap from './Mindmap.svelte';
  import { noteMindmap, ROOT_ID } from './note-mindmap';
  import type { MindmapEdits } from './mindmap-edits';
  import { nodeAt, parseOutline, type OutlineNode } from '../../../../shared/outline/outline';
  import {
    addChild, addSibling, deleteNode, demote, moveNode, promote, renameNode, type OutlineEdit,
  } from '../../../../shared/outline/outline-edits';
  import type { MindmapOrientation } from '../../../../shared/mindmap/mindmap-layout';
  import { announce } from '../../stores/announcer.svelte';
  import { getDialogStore } from '../../stores/dialogs.svelte';
  import { CONFIRM_KEYS } from '../../confirm-keys';

  interface Props {
    /** The note's text, as the editor has it. */
    content: string;
    /** The root's label. */
    title: string;
    /** Where the fold state is kept (with the note's path). */
    stateKey: string;
    /** The note's editor view, which every edit goes through. */
    getView: () => EditorView | undefined;
    /** The editor is showing beside the map: the two follow each other. */
    beside: boolean;
    /** The editor's cursor line (1-based), while it's beside. */
    cursorLine?: number | null;
  }
  let { content, title, stateKey, getView, beside, cursorLine = null }: Props = $props();

  const dialogs = getDialogStore();
  const outline = $derived(parseOutline(content));
  const map = $derived(noteMindmap(outline, title));

  // Kept per note, on this machine (a convenience: a private window just starts unfolded).
  const storeKey = $derived(`minerva.mindmap:${stateKey}`);
  function readState(): { folded: string[]; orientation: MindmapOrientation } {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as { folded?: unknown; orientation?: unknown } | null;
      return {
        folded: Array.isArray(raw?.folded) ? raw.folded.filter((f): f is string => typeof f === 'string') : [],
        orientation: raw?.orientation === 'radial' ? 'radial' : 'ltr',
      };
    } catch { return { folded: [], orientation: 'ltr' }; }
  }
  let saved = $state(readState());
  $effect(() => { void storeKey; saved = readState(); });
  function keep(next: typeof saved): void {
    saved = next;
    try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* not kept: a private window */ }
  }

  let selected = $state<string | null>(null);

  // The editor's cursor selects the node it's in.
  $effect(() => {
    if (!beside || cursorLine === null) return;
    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(cursorLine - 1, lines.length); i++) offset += lines[i]!.length + 1;
    const n = nodeAt(outline, offset);
    selected = n ? map.idOf.get(n) ?? null : ROOT_ID;
  });

  function onSelect(id: string): void {
    selected = id;
    // Selecting a node puts the editor's cursor on its line, without taking focus from the map.
    const view = beside ? getView() : undefined;
    const n = map.nodeOf.get(id);
    if (view && n && n.kind !== 'root') view.dispatch({ selection: { anchor: n.head.start }, scrollIntoView: true });
  }

  /**
   * Make an outline edit on the editor's view and say where the node went:
   * its id in the note as it now is (an edit can change a node's path).
   * `follow`: the block the edit inserts (an add, a move), or the node itself
   * where it stands (a rename — which, of an empty node, is an insertion too).
   */
  function apply(n: OutlineNode, edit: OutlineEdit, said: string, follow: 'inserted' | 'self' = 'inserted'): string | null {
    if ('refused' in edit) { announce(edit.refused); return null; }
    const view = getView();
    if (!view) { announce('The note isn\'t open for editing.'); return null; }
    if (edit.changes.length === 0) return map.idOf.get(n) ?? null;
    const changes = ChangeSet.of(edit.changes, view.state.doc.length);
    const inserted = follow === 'inserted' ? edit.changes.find((c) => c.from === c.to && c.insert.length > 0) : undefined;
    const start = inserted ? changes.mapPos(inserted.from, -1) + (inserted.insert.startsWith('\n') ? 1 : 0) : changes.mapPos(n.subtree.start, -1);
    view.dispatch({ changes, userEvent: 'input.mindmap' });
    const after = parseOutline(view.state.doc.toString());
    const moved = after.nodes.find((m) => m.head.start === start);
    announce(said);
    return moved ? noteMindmap(after, title).idOf.get(moved) ?? null : null;
  }

  const node = (id: string) => map.nodeOf.get(id);
  const sameKindIndex = (parent: OutlineNode, kind: OutlineNode['kind'], upTo: OutlineNode | null, moving: OutlineNode) =>
    parent.children.filter((c) => c.kind === kind && c !== moving && (upTo === null || parent.children.indexOf(c) < parent.children.indexOf(upTo))).length;

  const edits: MindmapEdits = {
    addChild: (id) => { const n = node(id); return n ? apply(n, addChild(outline, n, ''), 'Added a child') : null; },
    addSibling: (id) => { const n = node(id); return n ? apply(n, addSibling(outline, n, ''), 'Added a sibling') : null; },
    rename: (id, text) => { const n = node(id); return n ? apply(n, renameNode(outline, n, text), `Renamed to ${text}`, 'self') : null; },
    remove: async (id, opts) => {
      const n = node(id);
      if (!n) return false;
      if (n.children.length > 0 && !opts?.confirmed) {
        const ok = await dialogs.showConfirm(`Delete “${n.text}” and everything under it?`, CONFIRM_KEYS.mindmapDeleteSubtree, 'Delete');
        if (!ok) return false;
      }
      const edit = deleteNode(outline, n);
      if ('refused' in edit) { announce(edit.refused); return false; }
      apply(n, edit, `Deleted ${n.text || 'it'}`);
      return true;
    },
    drop: (id, targetId, where) => {
      const n = node(id);
      const t = node(targetId);
      if (!n || !t) return null;
      if (where === 'child') return apply(n, moveNode(outline, n, t, t.children.filter((c) => c.kind === n.kind && c !== n).length), `Moved into ${t.text || title}`);
      const parent = t.parent ?? outline.root;
      const index = sameKindIndex(parent, n.kind, t, n) + (where === 'after' && t.kind === n.kind ? 1 : 0);
      return apply(n, moveNode(outline, n, parent, index), `Moved ${where} ${t.text}`);
    },
    promote: (id) => { const n = node(id); return n ? apply(n, promote(outline, n), 'Promoted') : null; },
    demote: (id) => { const n = node(id); return n ? apply(n, demote(outline, n), 'Demoted') : null; },
    undo: () => { const v = getView(); if (v) undo(v); },
    redo: () => { const v = getView(); if (v) redo(v); },
  };
</script>

<div class="note-mindmap">
  <div class="nm-tools" role="group" aria-label="Map layout">
    <button type="button" class="nm-btn" aria-pressed={saved.orientation === 'ltr'} onclick={() => keep({ ...saved, orientation: 'ltr' })}>Left to right</button>
    <button type="button" class="nm-btn" aria-pressed={saved.orientation === 'radial'} onclick={() => keep({ ...saved, orientation: 'radial' })}>Radial</button>
  </div>
  <Mindmap
    tree={map.tree}
    orientation={saved.orientation}
    folded={saved.folded}
    onFold={(id, f) => keep({ ...saved, folded: f ? [...saved.folded, id] : saved.folded.filter((x) => x !== id) })}
    {selected}
    {onSelect}
    label={`Outline of ${title}. Tab adds a child, Enter a sibling, F2 renames, Delete removes, Command+[ and ] promote and demote.`}
    edit={edits}
  />
</div>

<style>
  .note-mindmap { position: relative; width: 100%; height: 100%; min-height: 0; }
  .nm-tools { position: absolute; top: 8px; left: 8px; display: flex; gap: 4px; z-index: 1; }
  .nm-btn { font: inherit; font-size: 12px; color: var(--text); background: var(--bg-button); border: 1px solid var(--border); border-radius: 4px; padding: 1px 8px; cursor: pointer; }
  .nm-btn[aria-pressed='true'] { border-color: var(--accent); }
</style>
