import { describe, it, expect, vi } from 'vitest';
import {
  formatCreators,
  formatDueStamp,
  isOverdue,
  statusGlyph,
  statusTitle,
} from '../../src/renderer/lib/sources/source-display';

// Pure display helpers behind the SourceListItem split (#672). The date
// helpers depend on "today" (#1943): the old version of this file read the
// real clock via `isoDaysFromNow()` at setup and again inside
// `isOverdue`/`formatDueStamp` at assert time, so a run straddling local
// midnight or a year boundary could disagree with itself between those two
// reads. Every case below instead pins the system clock (`vi.setSystemTime`)
// and `TZ`, following the pattern in `refactor/extract.test.ts`, so "now" is
// one fixed instant throughout a test regardless of when or where the suite
// actually runs — the suite-wide `TZ` pin in `vitest.config.mts` covers tests
// that don't touch the clock at all, but these do, so they pin their own.
const atInstant = (tz: string, instant: string, assert: () => void): void => {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(instant));
  try {
    assert();
  } finally {
    vi.useRealTimers();
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
};

// Arizona never observes DST, so this is a fixed, year-round UTC-7 offset —
// exercising a non-UTC zone (so a `toISOString()` regression would surface)
// without the offset itself varying by the calendar date under test.
const TZ = 'America/Phoenix';

// Formats the *local* calendar date, deliberately not `toISOString()`: that
// serializes in UTC, so a local-midnight Date in any zone east of UTC renders
// as the previous day. The helpers under test parse `${iso}T00:00:00` — local
// midnight — so the offsets have to be local too. Only valid while a fake
// clock from `atInstant` is active.
const isoDaysFromNow = (days: number): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe('formatCreators', () => {
  it('renders one, two, and many authors', () => {
    expect(formatCreators([])).toBe('');
    expect(formatCreators(['Curie'])).toBe('Curie');
    expect(formatCreators(['Curie', 'Joliot'])).toBe('Curie and Joliot');
    expect(formatCreators(['Curie', 'Joliot', 'Bohr'])).toBe('Curie et al.');
  });
});

describe('statusGlyph / statusTitle', () => {
  it('maps each read status to a glyph + label', () => {
    expect(statusGlyph('reading')).toBe('◐');
    expect(statusGlyph('read')).toBe('●');
    expect(statusGlyph('unread')).toBe('○');
    expect(statusGlyph('skipped')).toBe('×');
    expect(statusTitle('reading')).toBe('Reading');
    expect(statusTitle('skipped')).toBe('Skipped');
  });

  it('renders nothing for a null/absent status', () => {
    expect(statusGlyph(null)).toBe('');
    expect(statusTitle(null)).toBe('');
  });
});

describe('isOverdue', () => {
  it('is false for null / unparseable', () => {
    expect(isOverdue(null)).toBe(false);
    expect(isOverdue('not-a-date')).toBe(false);
  });

  it('is true strictly before today, false for today and the future', () => {
    atInstant(TZ, '2026-06-15T18:00:00Z', () => {
      expect(isOverdue(isoDaysFromNow(-1))).toBe(true);
      expect(isOverdue(isoDaysFromNow(0))).toBe(false); // due today is not overdue
      expect(isOverdue(isoDaysFromNow(3))).toBe(false);
    });
  });

  it('a due-today date one second before local midnight is still not overdue', () => {
    // The exact instant a real, unpinned clock read between computing
    // "today" and calling isOverdue() could roll over to the next calendar
    // day and flip this from false to true.
    atInstant(TZ, '2026-06-15T06:59:59Z', () => { // 23:59:59 the previous day in UTC-7
      expect(isOverdue(isoDaysFromNow(0))).toBe(false);
      expect(isOverdue(isoDaysFromNow(-1))).toBe(true);
    });
  });
});

describe('formatDueStamp', () => {
  it('falls back to the raw string for an unparseable date', () => {
    expect(formatDueStamp('garbage')).toBe('garbage');
  });

  it('omits the year for an in-current-year date, includes it otherwise', () => {
    atInstant(TZ, '2026-06-15T18:00:00Z', () => {
      const thisYear = new Date().getFullYear();
      const inYear = formatDueStamp(`${thisYear}-06-15`);
      expect(inYear).not.toMatch(String(thisYear)); // "Jun 15", no year
      const otherYear = formatDueStamp(`${thisYear + 2}-06-15`);
      expect(otherYear).toMatch(String(thisYear + 2)); // "Jun 15 2028"
    });
  });

  it('holds across a New Year straddle', () => {
    // One second before midnight on New Year's Eve: "now" is still the old
    // year, so a date in the old year omits it and one in the new year
    // (already elapsed in UTC, not yet locally) still counts as "not this
    // year" and includes it.
    atInstant(TZ, '2027-01-01T06:59:59Z', () => { // 23:59:59 Dec 31 2026 in UTC-7
      const thisYear = new Date().getFullYear();
      expect(thisYear).toBe(2026);
      expect(formatDueStamp('2026-12-31')).not.toMatch('2026');
      expect(formatDueStamp('2027-01-01')).toMatch('2027');
    });
  });
});
