/**
 * Section commands in the editor (#2963), from the outline edits a mindmap
 * makes (`shared/outline/outline-edits.ts`), useful without one:
 *
 * - **Move Section Up / Down** — the heading section or list item the cursor
 *   is in, with everything beneath it, past its neighbouring sibling.
 * - **Promote / Demote Heading** — the heading section the cursor is in, out
 *   to its parent's next sibling, or in under the heading before it; its own
 *   sub-headings come along and re-level with it.
 *
 * Each is one transaction (one ⌘Z). The cursor stays where it was in the
 * section, wherever the section went. An edit that can't be made (already
 * first, a heading at level 6) is said, not silently dropped.
 */
import type { Command, EditorView } from '@codemirror/view';
import { ChangeSet } from '@codemirror/state';
import { nodeAt, parseOutline, type OutlineNode } from '../../../shared/outline/outline';
import { demote, moveBy, promote, type OutlineEdit } from '../../../shared/outline/outline-edits';
import { announce } from '../stores/announcer.svelte';

function apply(view: EditorView, node: OutlineNode, edit: OutlineEdit, what: string): boolean {
  if ('refused' in edit) { announce(edit.refused); return true; }
  if (edit.changes.length === 0) return true;
  const { state } = view;
  const changes = ChangeSet.of(edit.changes, state.doc.length);
  // The section's new start: where its text was inserted, or (moved in place) where it was.
  const inserted = edit.changes.find((c) => c.from === c.to && c.insert.length > 0);
  const offset = state.selection.main.head - node.subtree.start;
  let anchor: number;
  if (inserted) {
    // A section put at the very end of a note without a final newline gets one first.
    anchor = changes.mapPos(inserted.from, -1) + (inserted.insert.startsWith('\n') ? 1 : 0) + offset;
  } else {
    anchor = changes.mapPos(state.selection.main.head);
  }
  const after = changes.newLength;
  view.dispatch({
    changes,
    selection: { anchor: Math.max(0, Math.min(after, anchor)) },
    scrollIntoView: true,
    userEvent: 'move.section',
  });
  announce(what);
  return true;
}

/** The node the cursor is in: the innermost, or the nearest heading. */
function at(view: EditorView, heading: boolean): { node: OutlineNode; outline: ReturnType<typeof parseOutline> } | null {
  const outline = parseOutline(view.state.doc.toString());
  let node = nodeAt(outline, view.state.selection.main.head);
  if (heading) while (node && node.kind !== 'heading') node = node.parent && node.parent.kind !== 'root' ? node.parent : null;
  return node ? { node, outline } : null;
}

const label = (n: OutlineNode) => (n.kind === 'heading' ? `“${n.text}”` : 'item');

export const moveSectionUp: Command = (view) => {
  const found = at(view, false);
  if (!found) return false;
  return apply(view, found.node, moveBy(found.outline, found.node, -1), `Moved ${label(found.node)} up`);
};

export const moveSectionDown: Command = (view) => {
  const found = at(view, false);
  if (!found) return false;
  return apply(view, found.node, moveBy(found.outline, found.node, 1), `Moved ${label(found.node)} down`);
};

export const promoteHeading: Command = (view) => {
  const found = at(view, true);
  if (!found) return false;
  return apply(view, found.node, promote(found.outline, found.node), `Promoted ${label(found.node)}`);
};

export const demoteHeading: Command = (view) => {
  const found = at(view, true);
  if (!found) return false;
  return apply(view, found.node, demote(found.outline, found.node), `Demoted ${label(found.node)}`);
};
