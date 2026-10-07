/**
 * What the object system does with a `date` or `datetime` property's value
 * (#2613, epic #2606): show it, sort it, filter it, and type it in the graph.
 * Every rule here reads the value through `date-precision.ts`, the one parser
 * (#2611), so a written value means the same span wherever it is used.
 *
 * - **Format** (`formatDateValue`): locale-formatted through `Intl`, at the
 *   value's own precision. `1969` shows as a year, `1969-07` as a month, and a
 *   clock time is shown only when one was written. Years ≤ 0 carry an era
 *   (`-0043` → "44 BC"). A value that isn't a date is shown as written.
 * - **Sort** (`compareDateValues`): by span start, then span end, so `1969`
 *   sorts with 1969 and `-0043` before `0044`, not by string.
 * - **Range** (`dateValueInRange`): the value's span start lies in
 *   [span(min).start, span(max).end). That is exactly what the old lexical rule
 *   meant for four-digit calendar values (pinned in `date-precision.test.ts`),
 *   and it stays right for signed years and mixed offsets, where string order
 *   doesn't.
 * - **Graph** (`xsdDateLiteral`): the XSD lexical form and datatype.
 *
 * **Time zones.** A clock time with no offset is floating wall-clock time; one
 * with `Z` or `±HH:MM` is an instant, read at the viewer's wall clock (the
 * runtime's zone unless `zoneOffsetMinutes` is injected). See
 * `date-precision.ts`.
 */
import type { PropertyType } from './type-def';
import {
  isClockPrecision, parseDateValue, spanOfParsed,
  type CivilSpan, type ParsedDate, type SpanOptions,
} from './date-precision';

/** Is this a property type whose values are dates (`date`, `datetime`)? */
export function isDateType(type: PropertyType | undefined): type is 'date' | 'datetime' {
  return type === 'date' || type === 'datetime';
}

function spanOf(raw: string, opts: SpanOptions): { p: ParsedDate; span: CivilSpan } | null {
  const p = parseDateValue(raw);
  const span = p ? spanOfParsed(p, opts) : null;
  return p && span ? { p, span } : null;
}

export interface FormatDateOptions extends SpanOptions {
  /** BCP 47 locale(s); the runtime's default when absent. */
  locale?: string | string[] | undefined;
}

/**
 * A value at its own precision, in the viewer's locale: "1969", "Jul 1969",
 * "Jul 20, 1969", "Jul 20, 1969, 8:17 PM" (en-US). Seconds show only when
 * they were written and aren't zero. Not a date → the text as written.
 */
export function formatDateValue(raw: string, opts: FormatDateOptions = {}): string {
  const read = spanOf(raw, opts);
  if (!read) return raw;
  const { p, span } = read;
  // The civil axis is calendar fields encoded as UTC, so format in UTC.
  const at = new Date(span.start);
  const fmt: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric' };
  if (p.precision !== 'year') fmt.month = 'short';
  if (p.precision !== 'year' && p.precision !== 'month') fmt.day = 'numeric';
  if (isClockPrecision(p.precision)) {
    fmt.hour = 'numeric';
    fmt.minute = '2-digit';
    if (at.getUTCSeconds() !== 0 || at.getUTCMilliseconds() !== 0) fmt.second = '2-digit';
  }
  // Without an era, Intl shows year -43 as "44" (the era year), so a year at
  // or before 1 BCE always carries one.
  if (at.getUTCFullYear() <= 0) fmt.era = 'short';
  return new Intl.DateTimeFormat(opts.locale, fmt).format(at);
}

/**
 * Sort order for date values: by span start, then span end (the narrower
 * span first, so `1969-01-01` before `1969`), then as text. A value that
 * isn't a date sorts after every date, and those compare as text.
 */
export function compareDateValues(a: string, b: string, opts: SpanOptions = {}): number {
  const sa = spanOf(a, opts)?.span;
  const sb = spanOf(b, opts)?.span;
  if (sa && sb) return sa.start - sb.start || sa.end - sb.end || compareText(a, b);
  if (sa) return -1;
  if (sb) return 1;
  return compareText(a, b);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Does `value` fall in [min, max]? True when its span starts within
 * [span(min).start, span(max).end): a bound is inclusive of its whole span,
 * so `max: 2026-05` keeps every moment of May. An absent or empty bound is
 * open. **Null when the value or a given bound isn't a date**, so the caller
 * can fall back rather than guess.
 */
export function dateValueInRange(
  value: string,
  min: string | null | undefined,
  max: string | null | undefined,
  opts: SpanOptions = {},
): boolean | null {
  const v = spanOf(value, opts)?.span;
  if (!v) return null;
  if (min !== null && min !== undefined && min !== '') {
    const lo = spanOf(min, opts)?.span;
    if (!lo) return null;
    if (v.start < lo.start) return false;
  }
  if (max !== null && max !== undefined && max !== '') {
    const hi = spanOf(max, opts)?.span;
    if (!hi) return null;
    if (v.start >= hi.end) return false;
  }
  return true;
}

export type XsdDateDatatype = 'gYear' | 'gYearMonth' | 'date' | 'dateTime';

/**
 * The graph literal for a date value: its XSD 1.1 lexical form and datatype,
 * or null when it isn't a date (the indexer then stores the plain string).
 *
 * - year → `xsd:gYear`, month → `xsd:gYearMonth`, day → `xsd:date`, clock →
 *   `xsd:dateTime`.
 * - **Years are written the XSD way**: at least four digits, a leading `-`
 *   for years ≤ -1, never a `+`. So YAML's `-43` (from `date: -0043`) is
 *   `-0043`, `44` is `0044`, `+12026` is `12026`.
 * - **A clock time always has seconds** (`T14:30` → `T14:30:00`), because
 *   `xsd:dateTime` requires them and a SPARQL comparison against a
 *   seconds-less literal is an error, which `FILTER` drops. A written
 *   fraction is kept to its milliseconds.
 * - **The offset is kept** (`+02:00`; a zero offset is written `Z`), and a
 *   floating value gets none, which is XSD's "no timezone" — the same floating reading.
 */
export function xsdDateLiteral(raw: string): { lexical: string; datatype: XsdDateDatatype } | null {
  const p = parseDateValue(raw);
  if (!p) return null;
  const y = `${p.year < 0 ? '-' : ''}${String(Math.abs(p.year)).padStart(4, '0')}`;
  if (p.precision === 'year') return { lexical: y, datatype: 'gYear' };
  const ym = `${y}-${two(p.month!)}`;
  if (p.precision === 'month') return { lexical: ym, datatype: 'gYearMonth' };
  const ymd = `${ym}-${two(p.day!)}`;
  if (p.precision === 'day') return { lexical: ymd, datatype: 'date' };
  const frac = p.precision === 'millisecond' ? `.${String(p.millisecond).padStart(3, '0')}` : '';
  const time = `${two(p.hour!)}:${two(p.minute!)}:${two(p.second ?? 0)}${frac}`;
  return { lexical: `${ymd}T${time}${offsetText(p.offsetMinutes)}`, datatype: 'dateTime' };
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

function offsetText(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes === 0) return 'Z';
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}
