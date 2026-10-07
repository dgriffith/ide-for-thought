/**
 * How the Timeline's axis (#2608) labels its ticks. (An event's own dates —
 * its spoken label, hover card and list row — go through the app's one value
 * formatter, `shared/objects/date-values.ts`'s `formatDateValue`.)
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
