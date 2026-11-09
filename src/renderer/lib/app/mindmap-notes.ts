/**
 * Editing a hierarchy of notes from the Mindmap layout (#2966): the host's
 * writes, each the app's own way of making that change.
 *
 * - **Add a child** makes a new note of the type, through the same path as
 *   any new typed note (`createTypedNote`: subtype, title, template), its
 *   parent property set to the parent. History: *Created by Mindmap*.
 * - **Reparent** (a drag, promote, demote) sets the one parent property on
 *   each note through the move store (`kanban-moves`), so it's undoable on
 *   its own ⌘Z and recorded *Moved by Mindmap*. To the top clears it.
 * - **Rename** renames the note's file, links updated, as the sidebar does.
 */
import { api } from '../ipc/client';
import { getKanbanMoveStore } from '../stores/kanban-moves.svelte';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { createTypedNote, noteNameFor } from './calendar-create';
import type { TypeInfo } from '../../../shared/objects/type-def';

export const MINDMAP_MOVE_CAUSE = 'Moved by Mindmap';
export const MINDMAP_CREATE_CAUSE = 'Created by Mindmap';

/** A parent property's value naming a note: a wiki-link by its path, which resolves whatever else shares the title. */
export function parentLinkFor(path: string): string {
  return `[[${path.replace(/\.md$/, '')}]]`;
}

export interface NoteRef { path: string; title: string }

export async function createChildNote(req: { type: TypeInfo; catalog: readonly TypeInfo[]; parentProperty: string; parent: NoteRef | null }): Promise<string | null> {
  return createTypedNote({
    type: req.type, catalog: req.catalog,
    values: req.parent ? { [req.parentProperty]: parentLinkFor(req.parent.path) } : {},
    cause: MINDMAP_CREATE_CAUSE, eyebrow: req.parent ? `New under ${req.parent.title}` : `New ${req.type.label}`, noun: 'note',
  });
}

/** Put `notes` under `parent` (null: at the top). Resolves to the paths written. */
export async function reparentNotes(notes: readonly NoteRef[], parentProperty: string, parent: NoteRef | null): Promise<string[]> {
  return getKanbanMoveStore().moveCards(notes, parentProperty, {
    value: parent ? parentLinkFor(parent.path) : null,
    label: parent ? parent.title : 'the top',
    kind: parent ? 'option' : 'no-value',
  }, { cause: MINDMAP_MOVE_CAUSE, surface: 'mindmap' });
}

export async function undoReparent(): Promise<string[]> {
  return getKanbanMoveStore().undoLastMove('mindmap', { cause: MINDMAP_MOVE_CAUSE });
}

/** Rename a note's file to `name` (its extension kept), links updated. Resolves to the new path, or null when it's unchanged. */
export async function renameNoteTo(path: string, name: string): Promise<string | null> {
  const stem = noteNameFor(name);
  if (!stem) return null;
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const ext = dot > slash ? path.slice(dot) : '';
  const next = `${slash >= 0 ? path.slice(0, slash + 1) : ''}${stem}${ext}`;
  if (next === path) return null;
  await api.notebase.rename(path, next);
  await getNotebaseStore().refresh();
  return next;
}
