/**
 * A new event drawn on the Calendar (#2954, epic #2949) — Minerva's half.
 * The plugin asks with `view.createEvent {start, end}` (a stretch it drew:
 * `shared/calendar/create-event.ts`), and this makes the note through the
 * new-note path a typed note always takes (#1064, #2489): the type's
 * scaffold of property keys, its template with placeholders filled, then
 * the *Date by* (and, for Event dated by `date`, `end`) set to the stretch.
 *
 * - **The user's write, not a proposal**: they drew it and named it. It's an
 *   ordinary save, so Local History records it ("Created by Calendar").
 * - **A parent type's view asks which type** (the view's own, or a subtype),
 *   with the type picker; then a title, with `showPrompt`. Either cancelled
 *   creates nothing.
 * - **Where:** the thoughtbase root, named by the title (`/`, `\` and `:`
 *   become `-`), with " 2", " 3"… when the name is taken. The calendar shows
 *   it once the view re-projects; the note isn't opened, so the user stays
 *   on the calendar, and the creation is announced.
 */
import { api } from '../ipc/client';
import { getDialogStore } from '../stores/dialogs.svelte';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { announce } from '../stores/announcer.svelte';
import { inheritsFrom } from '../../../shared/objects/inheritance';
import { buildTypedNoteScaffold } from '../../../shared/objects/scaffold';
import { setFieldValues } from '../../../shared/objects/kanban-move';
import { substituteTemplate } from '../../../shared/templates';
import { typePlaceholderContext } from '../../../shared/objects/property-placeholders';
import { createEventRefusal, valuesFor } from '../../../shared/calendar/create-event';
import type { PropertyDef, TypeInfo } from '../../../shared/objects/type-def';
import type { TimelineProperties } from '../../../shared/timeline/timeline-events';
import { logger } from '../../../shared/logger';

export interface CreateEventRequest {
  /** The view's type, and the catalog its subtypes are found in. */
  type: TypeInfo;
  catalog: readonly TypeInfo[];
  /** The view's properties (for the *Date by* property's kind) and its date fields. */
  properties: readonly PropertyDef[];
  dates: TimelineProperties;
  start: string;
  end: string | null;
  /** Local History's cause: "Created by Calendar". */
  cause?: string | undefined;
}

/** A note name from a typed title: no folder separators, no `:`. */
export function noteNameFor(title: string): string {
  return title.trim().replace(/[/\\:]/g, '-');
}

/**
 * Create the event (see the header). Resolves to the new note's path, or null
 * when the user cancelled, the request was invalid, or the write failed.
 */
export async function createCalendarEvent(req: CreateEventRequest): Promise<string | null> {
  if (createEventRefusal(req.start, req.end) !== null) return null;
  const dialogs = getDialogStore();
  const byId = new Map(req.catalog.map((t) => [t.id, t] as const));
  const subtypes = req.catalog.filter((t) => t.id !== req.type.id && inheritsFrom(t.id, req.type.id, byId));
  const type = subtypes.length > 0
    ? await dialogs.showTypePicker([req.type, ...subtypes], { eyebrow: 'New event', title: 'Which type is it?', apply: 'choose' })
    : req.type;
  if (!type) return null;
  const title = (await dialogs.showPrompt(`New ${type.label} — title:`))?.trim();
  if (!title) return null;

  const dateProp = req.properties.find((p) => p.name === req.dates.dateProperty);
  const { start, end } = valuesFor(dateProp?.type, req.start, req.dates.endProperty === null ? null : req.end);
  const values: Record<string, string> = { [req.dates.dateProperty]: start };
  if (req.dates.endProperty !== null && end !== null) values[req.dates.endProperty] = end;

  let body = '';
  const template = type.effectiveTemplate ?? type.template;
  if (template) {
    const sub = await substituteTemplate(template, {
      title,
      prompt: (label: string) => dialogs.showPrompt(`${label}:`),
      properties: typePlaceholderContext(type, values),
    });
    if (sub.cancelled) return null;
    body = sub.content;
  }
  const scaffold = buildTypedNoteScaffold(type, body).content;
  const content = setFieldValues(scaffold, Object.entries(values).map(([key, value]) => ({ key, value })))?.content ?? scaffold;

  try {
    const path = await freePath(noteNameFor(title));
    await api.notebase.writeFile(path, content, req.cause ? { cause: req.cause } : undefined);
    await getNotebaseStore().refresh();
    announce(`Created ${title}.`);
    return path;
  } catch (err) {
    logger('objects').warn('calendar create failed for', title, err);
    announce(`Couldn’t create ${title}.`);
    return null;
  }
}

/** `name.md` at the root, or `name 2.md`, `name 3.md`… when it's taken. */
async function freePath(name: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const path = `${n === 1 ? name : `${name} ${n}`}.md`;
    if (!(await api.notebase.fileExists(path))) return path;
  }
  throw new Error(`no free name for ${name}`);
}
