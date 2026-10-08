/**
 * Moving objects by editing their frontmatter — the write half of a Kanban
 * card move (#2603, epic #2600) and a Calendar reschedule (#2703, epic #2699).
 * A move is a user edit of one or a few frontmatter fields, so per the
 * renderer data-flow rule (#1086) the mutation lives here; the board calls
 * `moveCards`, the calendar `rescheduleEvent`, and both `undoLastMove`.
 *
 * - **One write path: "set these fields".** Each note is read from disk, its
 *   fields set in ONE edit with `setFieldValues` (`shared/objects/kanban-move.ts`
 *   — only those keys' lines change, quoting, CRLF and a BOM are kept), and
 *   saved through `api.notebase.writeFile`: the normal save path, which
 *   re-indexes the note and records ONE Local History revision like any other
 *   save. A card move sets one field (the grouping property); a reschedule
 *   sets the start and the end together, so it is one save, one revision and
 *   one undo entry. A note that already says what the move would write isn't
 *   written.
 * - **Reschedule** (`rescheduleEvent`) reads the start and end AS WRITTEN on
 *   disk and moves them by whole days with `rescheduleByDays`
 *   (`shared/objects/date-shift.ts`: precision, written form and duration
 *   kept; an offset time corrected around the viewer's DST change). It
 *   refuses — announcing why, writing nothing — an event whose start or end
 *   is only a month or a year (decision 5 on #2699: open it to edit).
 * - **Open tabs** follow through `syncOpenTabsToDisk`: a clean tab reloads, a
 *   tab with unsaved edits gets the external-change conflict prompt.
 * - **Undo.** Each move is pushed on a small session stack, tagged with the
 *   surface it came from, and ⌘Z on a board (or a calendar grid) pops that
 *   surface's newest move — a calendar never undoes a board's move. Undo
 *   writes each note's previous text back, byte for byte, when the note still
 *   holds exactly what the move wrote; if it was edited since, only the moved
 *   fields are put back, and only when every one of them still holds what the
 *   move wrote (a later edit to any of them wins over an old undo, and the
 *   note is left alone). An undo is itself a save, so it lands in Local
 *   History too, and restoring from history works for any move, undone or not.
 * - **Feedback.** A move, a refusal or an undo is spoken through the shared
 *   live region; a note that couldn't be written raises a toast (which is
 *   spoken too). `revision` is bumped after every write so type views
 *   re-project, and `lastMove` names the moved paths so a board can keep
 *   focus on the card.
 *
 * A user action, not an LLM write: no approval engine.
 */
import { api } from '../ipc/client';
import { announce } from './announcer.svelte';
import { getToastStore } from './toasts.svelte';
import { syncOpenTabsToDisk } from './open-tab-sync';
import { groupValueOf, setFieldValues, type FieldValue, type MoveTarget } from '../../../shared/objects/kanban-move';
import { rescheduleByDays } from '../../../shared/objects/date-shift';
import { rescheduleRefusalText } from '../../../shared/objects/reschedule-text';
import { logger } from '../../../shared/logger';

/** A card the board asks to move: its note and the title it shows. */
export interface MoveCard {
  path: string;
  title: string;
}

/** Where a move came from — each has its own ⌘Z. */
export type MoveSurface = 'board' | 'calendar';

/** One field a move changed: what it held before and what the move wrote (null = absent). */
interface FieldChange {
  key: string;
  previous: string | null;
  written: string | null;
}

interface MovedNote {
  path: string;
  title: string;
  /** The note's text before the move, and what the move wrote. */
  before: string;
  after: string;
  fields: FieldChange[];
  /** Where an undo puts it back to, for the announcement ("active", "Monday, 5 October 2026"). */
  backLabel: string;
}

interface MoveRecord {
  surface: MoveSurface;
  notes: MovedNote[];
}

/** One note to write: its fields, and the words for the announcements. */
interface PlannedMove {
  fields: FieldValue[];
  backLabel: string;
}

/** How many moves ⌘Z can walk back (across both surfaces). */
export const UNDO_DEPTH = 20;

let revision = $state(0);
let lastMove = $state<{ seq: number; paths: string[] } | null>(null);
let undoStack = $state<MoveRecord[]>([]);
let seq = 0;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const YAML_ERROR = 'its frontmatter has a YAML error';

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
 * Write one note's planned fields (the shared half of every move). Resolves
 * to the moved note, null when it already said that, or throws a message for
 * the toast.
 */
async function writeFields(card: MoveCard, before: string, plan: PlannedMove): Promise<MovedNote | null> {
  const result = setFieldValues(before, plan.fields);
  if (result === null) throw new Error(YAML_ERROR);
  if (!result.changed) return null;
  await api.notebase.writeFile(card.path, result.content);
  return {
    path: card.path,
    title: card.title,
    before,
    after: result.content,
    fields: plan.fields.map((f) => ({ key: f.key, previous: groupValueOf(before, f.key) ?? null, written: f.value })),
    backLabel: plan.backLabel,
  };
}

/** Record, announce and sync what a move wrote. */
async function finishMove(surface: MoveSurface, moved: MovedNote[], spoken: string): Promise<string[]> {
  const paths = moved.map((m) => m.path);
  if (moved.length === 0) return paths;
  undoStack = [...undoStack, { surface, notes: moved }].slice(-UNDO_DEPTH);
  landed(paths);
  announce(spoken);
  await syncOpenTabsToDisk(paths);
  return paths;
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
      const note = await writeFields(card, before, {
        fields: [{ key: property, value: target.value }],
        backLabel: groupValueOf(before, property) ?? 'No value',
      });
      if (note) moved.push(note);
    } catch (err) {
      if (!(err instanceof Error && err.message === YAML_ERROR)) logger('objects').warn('kanban move failed for', card.path, err);
      failures.push({ title: card.title, error: errorText(err) });
    }
  }
  const paths = await finishMove('board', moved, `Moved ${cardsPhrase(moved)} to ${target.label}.`);
  reportFailures('move', failures);
  return paths;
}

/** The fields a calendar reschedules: the view's *Date by* and, for Event, its `end`. */
export interface RescheduleFields {
  start: string;
  end: string | null;
}

export type RescheduleOutcome =
  | { ok: true; paths: string[] }
  /** Refused (and announced): the sentence that was spoken. */
  | { ok: false; refusal: string }
  /** The write failed (and was toasted), or there was nothing to write. */
  | { ok: false; refusal: null };

/**
 * Reschedule an event by `days` whole days (a drag's drop day − grab day, or
 * *Move to date…*'s target − `startDayOf(start)`), its end following. `to` and
 * `back` name the days for the announcements ("Monday, 12 October 2026").
 */
async function rescheduleEvent(
  event: MoveCard,
  fields: RescheduleFields,
  days: number,
  labels: { to: string; back: string },
): Promise<RescheduleOutcome> {
  let before: string;
  try {
    before = await api.notebase.readFile(event.path);
  } catch (err) {
    logger('objects').warn('calendar reschedule failed for', event.path, err);
    reportFailures('move', [{ title: event.title, error: errorText(err) }]);
    return { ok: false, refusal: null };
  }
  const start = groupValueOf(before, fields.start);
  if (start === undefined) {
    reportFailures('move', [{ title: event.title, error: YAML_ERROR }]);
    return { ok: false, refusal: null };
  }
  const end = fields.end === null ? null : groupValueOf(before, fields.end) ?? null;
  const r = rescheduleByDays(start ?? '', end, days);
  if (!r.ok) {
    const refusal = rescheduleRefusalText(r.reason, { title: event.title, start: start ?? '', end });
    announce(refusal);
    return { ok: false, refusal };
  }
  const planned: FieldValue[] = [{ key: fields.start, value: r.start }];
  if (fields.end !== null && r.end !== null) planned.push({ key: fields.end, value: r.end });
  try {
    const note = await writeFields(event, before, { fields: planned, backLabel: labels.back });
    const paths = await finishMove('calendar', note ? [note] : [], `Moved ${event.title} to ${labels.to}.`);
    return paths.length > 0 ? { ok: true, paths } : { ok: false, refusal: null };
  } catch (err) {
    if (!(err instanceof Error && err.message === YAML_ERROR)) logger('objects').warn('calendar reschedule failed for', event.path, err);
    reportFailures('move', [{ title: event.title, error: errorText(err) }]);
    return { ok: false, refusal: null };
  }
}

/** The text an undo writes for `note`, or null to leave it alone (see the header). */
function undoneText(note: MovedNote, current: string): string | null {
  if (current === note.after) return note.before;
  const untouched = note.fields.every((f) => (groupValueOf(current, f.key) ?? null) === f.written);
  if (!untouched) return null;
  return setFieldValues(current, note.fields.map((f) => ({ key: f.key, value: f.previous })))?.content ?? null;
}

/**
 * Undo the most recent move made on `surface` (⌘Z on a board or a calendar).
 * Resolves to the paths written back; empty when there was nothing to undo or
 * every note had moved on.
 */
async function undoLastMove(surface: MoveSurface = 'board'): Promise<string[]> {
  const at = undoStack.findLastIndex((r) => r.surface === surface);
  if (at === -1) { announce(`Nothing to undo on the ${surface}.`); return []; }
  const record = undoStack[at]!;
  undoStack = undoStack.filter((_, i) => i !== at);
  const restored: MovedNote[] = [];
  const skipped: MovedNote[] = [];
  const failures: { title: string; error: string }[] = [];
  for (const note of record.notes) {
    try {
      const current = await api.notebase.readFile(note.path);
      const next = undoneText(note, current);
      if (next === null || next === current) { skipped.push(note); continue; }
      await api.notebase.writeFile(note.path, next);
      restored.push(note);
    } catch (err) {
      logger('objects').warn(`${surface === 'board' ? 'kanban' : 'calendar'} undo failed for`, note.path, err);
      failures.push({ title: note.title, error: errorText(err) });
    }
  }
  const paths = restored.map((n) => n.path);
  if (restored.length > 0) {
    landed(paths);
    const back = restored.length === 1 ? ` back to ${restored[0]!.backLabel}` : '';
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
    /** Is there a board move to undo? */
    get canUndo(): boolean { return undoStack.some((r) => r.surface === 'board'); },
    /** Is there a calendar move to undo? */
    get canUndoReschedule(): boolean { return undoStack.some((r) => r.surface === 'calendar'); },
    moveCards,
    rescheduleEvent,
    undoLastMove,
  };
}
