/**
 * The Timeline's events (#2608): each instance's `date` / `end` read once per
 * data revision into civil-axis spans (`dateRange`, the spike's Decision 2),
 * or set aside for the Undated tray with a reason. Pure, so it tests without
 * a DOM, and kept out of the zoom path: at 10,000 events this read is the
 * expensive part (the spike measured ~23 ms), so a zoom or pan never repeats it.
 *
 * - **No `date`** → Undated, "No date". An unreadable one → Undated, saying
 *   what couldn't be read. One the timeline can't draw (outside years
 *   −99,999..99,999) → Undated, "outside the timeline's range". Nothing is
 *   silently dropped.
 * - **An `end` that isn't after the start, or isn't a date,** is set aside:
 *   the event stays at its start, and `endIssue` says why — the hover card
 *   flags it (the epic's decision 2). It does not go to the Undated tray.
 * - **A partial date** (`1969`, `1969-07` — no day) is uncertain across its
 *   whole span: its stretch of the drawing is hatched (`segments`). A range's
 *   uncertain stretches are a partial start's span and a partial end's span;
 *   what lies between is certain. A full date or a clock time is certain.
 */
import { dateRange, type CivilSpan, type EndIssue } from '../../../../shared/objects/date-precision';
import type { TypeInstanceRow } from '../../../../shared/objects/type-def';
import { formatCivil, formatCivilRange, isPartial } from './timeline-format';
import { DRAWABLE_END, DRAWABLE_START, type Domain } from './timeline-scale';

/** The Event type's properties a timeline reads (stock `event.md`; Meeting inherits them). */
export const DATE_PROPERTY = 'date';
export const END_PROPERTY = 'end';

/** A stretch of an event's drawing: `approx` ones are hatched. */
export interface Segment {
  start: number;
  end: number;
  approx: boolean;
}

export interface TimelineEvent {
  /** The note path — unique, the packer's final tie-break. */
  key: string;
  inst: TypeInstanceRow;
  title: string;
  /** Civil ms, [start, end). */
  start: number;
  end: number;
  startSpan: CivilSpan;
  /** The written end's span when it was used. */
  endSpan: CivilSpan | null;
  /** A bar (a usable `end` was written) rather than a point. */
  ranged: boolean;
  /** Any of the drawing is uncertain (a partial date). */
  approx: boolean;
  segments: Segment[];
  /** "20 July 1969", "16–24 July 1969" (formatted on first read). */
  readonly dateText: string;
  /** What the event is called to a screen reader: "Moon landing, 20 July 1969". */
  readonly label: string;
  /** Why a written `end` was set aside, for the hover card; null when it wasn't. */
  endNote: string | null;
}

export type UndatedReason = 'missing' | 'invalid' | 'out-of-range';

export interface UndatedEvent {
  key: string;
  inst: TypeInstanceRow;
  title: string;
  reason: UndatedReason;
  /** "No date", "Couldn't read the date '1969-02-30'", … */
  reasonText: string;
}

export interface TimelineModel {
  dated: TimelineEvent[];
  undated: UndatedEvent[];
  /** The dated events' extent, or null when none is dated. */
  extent: Domain | null;
}

/** The hatched and solid stretches of [start, end) — see the header. */
export function segmentsOf(start: number, end: number, startSpan: CivilSpan, endSpan: CivilSpan | null): Segment[] {
  const approxStartEnd = isPartial(startSpan.precision) ? Math.min(startSpan.end, end) : start;
  const approxEndStart = endSpan && isPartial(endSpan.precision) ? Math.max(endSpan.start, start) : end;
  if (approxEndStart <= approxStartEnd) {
    // The uncertain stretches meet (or there is no certain middle): hatched throughout.
    return [{ start, end, approx: approxStartEnd > start || approxEndStart < end }];
  }
  const out: Segment[] = [];
  if (approxStartEnd > start) out.push({ start, end: approxStartEnd, approx: true });
  out.push({ start: approxStartEnd, end: approxEndStart, approx: false });
  if (approxEndStart < end) out.push({ start: approxEndStart, end, approx: true });
  return out;
}

function text(v: string | null | undefined): string | null {
  return v === null || v === undefined || v.trim() === '' ? null : v.trim();
}

/** Read every instance once (see the header). `locale` is the viewer's in the app. */
export function buildTimelineModel(
  instances: readonly TypeInstanceRow[],
  opts: { dateProperty?: string; endProperty?: string; locale?: string } = {},
): TimelineModel {
  const dateProp = opts.dateProperty ?? DATE_PROPERTY;
  const endProp = opts.endProperty ?? END_PROPERTY;
  const dated: TimelineEvent[] = [];
  const undated: UndatedEvent[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const inst of instances) {
    const rawDate = text(inst.values[dateProp]);
    const rawEnd = text(inst.values[endProp]);
    const r = dateRange(rawDate, rawEnd);
    if (!r.ok) {
      undated.push({
        key: inst.path, inst, title: inst.title, reason: r.reason,
        reasonText: r.reason === 'missing' ? 'No date' : `Couldn't read the date '${rawDate}'`,
      });
      continue;
    }
    const { start, end, startSpan, endSpan, endIssue } = r.range;
    if (start < DRAWABLE_START || end > DRAWABLE_END) {
      undated.push({ key: inst.path, inst, title: inst.title, reason: 'out-of-range', reasonText: `Outside the timeline's range (${rawDate})` });
      continue;
    }
    const endNote = endIssueNote(endIssue, rawEnd);
    const segments = segmentsOf(start, end, startSpan, endSpan);
    // Formatting is most of the cost of this read (Intl, per event), and only
    // drawn or listed events are ever named, so it waits until asked.
    let dateText: string | undefined;
    dated.push({
      key: inst.path, inst, title: inst.title, start, end, startSpan, endSpan,
      ranged: endSpan !== null,
      approx: segments.some((s) => s.approx),
      segments,
      get dateText() {
        return (dateText ??= endSpan
          ? formatCivilRange(startSpan.start, startSpan.precision, endSpan.start, endSpan.precision, opts.locale)
          : formatCivil(startSpan.start, startSpan.precision, opts.locale));
      },
      get label() { return `${inst.title}, ${this.dateText}${endNote ? ' (end date ignored)' : ''}`; },
      endNote,
    });
    lo = Math.min(lo, start);
    hi = Math.max(hi, end);
  }
  return { dated, undated, extent: dated.length > 0 ? { start: lo, end: hi } : null };
}

function endIssueNote(issue: EndIssue | null, rawEnd: string | null): string | null {
  if (issue === 'before-start') return `End date ignored: ${rawEnd} is before the start`;
  if (issue === 'invalid') return `End date ignored: couldn't read '${rawEnd}'`;
  return null;
}
