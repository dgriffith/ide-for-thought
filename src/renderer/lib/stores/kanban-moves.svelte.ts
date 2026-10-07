/**
 * Moving cards between a Kanban board's columns (#2603, epic #2600) — the
 * write half. A card move is a user edit of ONE frontmatter field, so per the
 * renderer data-flow rule (#1086) the mutation lives here and the board calls
 * `moveCards` / `undoLastMove`.
 *
 * - **The write** reads each note from disk, sets the grouping property with
 *   `setGroupValue` (`shared/objects/kanban-move.ts` — only that key's lines
 *   change), and saves through `api.notebase.writeFile`: the normal save path,
 *   which re-indexes the note and records a Local History revision like any
 *   other save. A note already in the target column isn't written.
 * - **Open tabs** follow through `syncOpenTabsToDisk`: a clean tab reloads, a
 *   tab with unsaved edits gets the external-change conflict prompt.
 * - **Undo.** Each move is pushed on a small session stack, and ⌘Z on a board
 *   pops it. Undo writes each note's previous text back, byte for byte, when
 *   the note still holds exactly what the move wrote; if it was edited since,
 *   only the grouping field is put back, and if that field changed too the
 *   note is left alone (a later edit wins over an old undo). An undo is itself
 *   a save, so it lands in Local History too, and restoring from history works
 *   for any move, undone or not.
 * - **Feedback.** A move or undo is spoken through the shared live region;
 *   a note that couldn't be written raises a toast (which is spoken too).
 *   `revision` is bumped after every write so type views re-project, and
 *   `lastMove` names the moved paths so a board can keep focus on the card.
 *
 * A user action, not an LLM write: no approval engine.
 */
import { api } from '../ipc/client';
import { announce } from './announcer.svelte';
import { getToastStore } from './toasts.svelte';
import { syncOpenTabsToDisk } from './open-tab-sync';
import { groupValueOf, setGroupValue, type MoveTarget } from '../../../shared/objects/kanban-move';
import { logger } from '../../../shared/logger';

/** A card the board asks to move: its note and the title it shows. */
export interface MoveCard {
  path: string;
  title: string;
}

interface MovedNote {
  path: string;
  title: string;
  /** The note's text before the move, and what the move wrote. */
  before: string;
  after: string;
  /** The grouping field's value before the move (null = No value). */
  previousValue: string | null;
}

interface MoveRecord {
  property: string;
  target: MoveTarget;
  notes: MovedNote[];
}

/** How many moves ⌘Z can walk back. */
export const UNDO_DEPTH = 20;

let revision = $state(0);
let lastMove = $state<{ seq: number; paths: string[] } | null>(null);
let undoStack = $state<MoveRecord[]>([]);
let seq = 0;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function cardsPhrase(notes: readonly { title: string }[]): string {
  return notes.length === 1 ? notes[0]!.title : `${notes.length} cards`;
}

function landed(paths: string[]): void {
  revision++;
  lastMove = { seq: ++seq, paths };
}

function reportFailures(verb: string, failures: { title: string; error: string }[]): void {
  if (failures.length === 0) return;
  const first = failures[0]!;
  const more = failures.length > 1 ? ` (and ${failures.length - 1} more)` : '';
  getToastStore().push({ message: `Couldn’t ${verb} ${first.title}: ${first.error}${more}` });
}

/**
 * Move `cards` to `target` by setting `property` on each note. Resolves to the
 * paths actually written (empty when every card was already there, or every
 * write failed).
 */
async function moveCards(cards: readonly MoveCard[], property: string, target: MoveTarget): Promise<string[]> {
  const moved: MovedNote[] = [];
  const failures: { title: string; error: string }[] = [];
  for (const card of cards) {
    try {
      const before = await api.notebase.readFile(card.path);
      const result = setGroupValue(before, property, target.value);
      if (result === null) { failures.push({ title: card.title, error: 'its frontmatter has a YAML error' }); continue; }
      if (!result.changed) continue;
      await api.notebase.writeFile(card.path, result.content);
      moved.push({ path: card.path, title: card.title, before, after: result.content, previousValue: groupValueOf(before, property) ?? null });
    } catch (err) {
      logger('objects').warn('kanban move failed for', card.path, err);
      failures.push({ title: card.title, error: errorText(err) });
    }
  }
  const paths = moved.map((m) => m.path);
  if (moved.length > 0) {
    undoStack = [...undoStack, { property, target, notes: moved }].slice(-UNDO_DEPTH);
    landed(paths);
    announce(`Moved ${cardsPhrase(moved)} to ${target.label}.`);
    await syncOpenTabsToDisk(paths);
  }
  reportFailures('move', failures);
  return paths;
}

/**
 * Undo the most recent move (⌘Z on a board). Resolves to the paths written
 * back; empty when there was nothing to undo or every note had moved on.
 */
async function undoLastMove(): Promise<string[]> {
  const record = undoStack[undoStack.length - 1];
  if (!record) { announce('Nothing to undo on the board.'); return []; }
  undoStack = undoStack.slice(0, -1);
  const restored: MovedNote[] = [];
  const skipped: MovedNote[] = [];
  const failures: { title: string; error: string }[] = [];
  for (const note of record.notes) {
    try {
      const current = await api.notebase.readFile(note.path);
      let next: string | null = null;
      if (current === note.after) next = note.before;
      else if (groupValueOf(current, record.property) === record.target.value) {
        next = setGroupValue(current, record.property, note.previousValue)?.content ?? null;
      }
      if (next === null || next === current) { skipped.push(note); continue; }
      await api.notebase.writeFile(note.path, next);
      restored.push(note);
    } catch (err) {
      logger('objects').warn('kanban undo failed for', note.path, err);
      failures.push({ title: note.title, error: errorText(err) });
    }
  }
  const paths = restored.map((n) => n.path);
  if (restored.length > 0) {
    landed(paths);
    const back = restored.length === 1 ? ` back to ${restored[0]!.previousValue ?? 'No value'}` : '';
    announce(`Undid the move: ${cardsPhrase(restored)}${back}.`);
    await syncOpenTabsToDisk(paths);
  } else if (failures.length === 0) {
    announce(`Nothing undone: ${cardsPhrase(skipped)} changed since the move.`);
  }
  reportFailures('undo the move of', failures);
  return paths;
}

export function getKanbanMoveStore() {
  return {
    /** Bumped after every move or undo that wrote something. */
    get revision(): number { return revision; },
    /** The last move or undo that wrote something: its paths, and a sequence number. */
    get lastMove(): { seq: number; paths: string[] } | null { return lastMove; },
    get canUndo(): boolean { return undoStack.length > 0; },
    moveCards,
    undoLastMove,
  };
}

