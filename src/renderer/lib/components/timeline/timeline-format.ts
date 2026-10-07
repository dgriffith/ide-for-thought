/**
 * How the Timeline (#2608) writes a date for a person: an event's spoken
 * label ("Moon landing, 20 July 1969"), its hover card, and the axis's tick
 * labels.
 *
 * Every value is a civil-axis ms (`shared/objects/date-precision.ts`), so it is
 * formatted with `Intl.DateTimeFormat` in `timeZone: 'UTC'` — the civil axis's
 * own reading, the same for every viewer. Never d3-time-format's `%Y`, which
 * writes year 12026 as "2026" and -43 as "-0043" (the spike, Decision 4):
 * `Intl` gives "12026", and with `era` "44 BC". An era is added only where a
 * year ≤ 0 is in play, so ordinary dates read as they always do.
 *
 * `locale` is the viewer's (undefined) in the app; tests pin one.
 */
import type { DatePrecision } from '../../../../shared/objects/date-precision';

/** Which fields a precision writes. */
function fieldsFor(precision: DatePrecision): Intl.DateTimeFormatOptions {
  switch (precision) {
    case 'year': return { year: 'numeric' };
    case 'month': return { year: 'numeric', month: 'long' };
    case 'day': return { year: 'numeric', month: 'long', day: 'numeric' };
    case 'minute': return { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    case 'second': return { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    case 'millisecond': return { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 };
  }
}

/** The (proleptic, astronomical) year of a civil ms. */
export function civilYear(ms: number): number {
  return new Date(ms).getUTCFullYear();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' });
    formatters.set(key, f);
  }
  return f;
}

/** One value at its precision: "1969", "July 1969", "20 July 1969", "20 July 1969 at 20:17", "44 BC". */
export function formatCivil(ms: number, precision: DatePrecision, locale?: string): string {
  const era = civilYear(ms) <= 0 ? { era: 'short' as const } : {};
  return formatter(locale, { ...fieldsFor(precision), ...era }).format(new Date(ms));
}

/**
 * A range for a person: "16–24 July 1969", "1618 – 1648", "20 July 1969,
 * 14:00 – 16:00". `start` is the start value's span start; `last` is where the
 * range's written end is — its span start at calendar precision (the end is
 * inclusive of that whole span) or the instant itself at clock precision.
 * Same precision both sides → `formatRange`, which drops what they share.
 */
export function formatCivilRange(
  start: number, startPrecision: DatePrecision,
  last: number, lastPrecision: DatePrecision,
  locale?: string,
): string {
  const era = civilYear(start) <= 0 || civilYear(last) <= 0 ? { era: 'short' as const } : {};
  if (startPrecision === lastPrecision) {
    const f = formatter(locale, { ...fieldsFor(startPrecision), ...era });
    return f.formatRange(new Date(start), new Date(last));
  }
  const a = formatter(locale, { ...fieldsFor(startPrecision), ...era }).format(new Date(start));
  const b = formatter(locale, { ...fieldsFor(lastPrecision), ...era }).format(new Date(last));
  return `${a} – ${b}`;
}

/** The coarsest unit an axis's ticks step by. */
export type TickUnit = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

/**
 * One tick's label. `withContext` adds the next unit up — the first tick, and
 * each one where that unit turns over (a new year on a month axis, midnight on
 * an hour axis), so a zoomed-in axis still says which year or day it is.
 * `era` when any year on the axis is ≤ 0 (the spike: add `era` only then).
 */
export function formatTick(ms: number, unit: TickUnit, opts: { withContext: boolean; era: boolean; locale?: string }): string {
  const era = opts.era ? { era: 'short' as const } : {};
  let fields: Intl.DateTimeFormatOptions;
  switch (unit) {
    case 'year': fields = { year: 'numeric', ...era }; break;
    case 'month': fields = opts.withContext ? { year: 'numeric', month: 'short', ...era } : { month: 'short' }; break;
    case 'day': fields = opts.withContext ? { year: 'numeric', month: 'short', day: 'numeric', ...era } : { month: 'short', day: 'numeric' }; break;
    case 'hour':
    case 'minute': fields = opts.withContext ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' }; break;
    case 'second': fields = { hour: '2-digit', minute: '2-digit', second: '2-digit' }; break;
  }
  return formatter(opts.locale, fields).format(new Date(ms));
}

/** Is a precision a partial date — written without its day (`1969`, `1969-07`)? */
export function isPartial(precision: DatePrecision): boolean {
  return precision === 'year' || precision === 'month';
}
