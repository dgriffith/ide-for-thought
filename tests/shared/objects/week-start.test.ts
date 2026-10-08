/**
 * The Calendar's week start (#2702, decision 4 on #2699): Automatic from the
 * locale's region via `getWeekInfo()`, or a fixed Monday / Sunday / Saturday.
 */
import { describe, it, expect } from 'vitest';
import { parseWeekStartSetting, resolveWeekStart, weekStartForLocale } from '../../../src/shared/objects/week-start';

describe('weekStartForLocale', () => {
  it('reads the region\'s first day (the vision doc\'s measurements)', () => {
    expect(weekStartForLocale('en-US')).toBe(7);
    expect(weekStartForLocale('en-GB')).toBe(1);
    expect(weekStartForLocale('de-DE')).toBe(1);
    expect(weekStartForLocale('en-DE')).toBe(1); // English in Germany: the region decides
    expect(weekStartForLocale('ar-EG')).toBe(6);
  });

  it('accepts a POSIX-style tag', () => {
    expect(weekStartForLocale('en_GB')).toBe(1);
  });

  it('honours the -u-fw- extension', () => {
    expect(weekStartForLocale('en-US-u-fw-mon')).toBe(1);
  });

  it('is null for nothing, or for a malformed tag, without throwing', () => {
    expect(weekStartForLocale(null)).toBeNull();
    expect(weekStartForLocale('')).toBeNull();
    expect(weekStartForLocale('not a locale!')).toBeNull();
  });
});

describe('resolveWeekStart', () => {
  it('a fixed choice ignores the locale', () => {
    expect(resolveWeekStart('monday', ['en-US'])).toBe(1);
    expect(resolveWeekStart('sunday', ['de-DE'])).toBe(7);
    expect(resolveWeekStart('saturday', ['de-DE'])).toBe(6);
  });

  it('Automatic takes the first locale that answers: the system\'s, then the renderer\'s', () => {
    expect(resolveWeekStart('auto', ['en-DE', 'en-US'])).toBe(1);
    expect(resolveWeekStart('auto', [null, 'en-US'])).toBe(7);
    expect(resolveWeekStart('auto', ['???', 'en-GB'])).toBe(1);
  });

  it('falls back to Monday when none answers', () => {
    expect(resolveWeekStart('auto', [])).toBe(1);
    expect(resolveWeekStart('auto', [null, undefined])).toBe(1);
  });
});

describe('parseWeekStartSetting', () => {
  it('keeps the four, and reads anything else as Automatic', () => {
    for (const v of ['auto', 'monday', 'sunday', 'saturday']) expect(parseWeekStartSetting(v)).toBe(v);
    expect(parseWeekStartSetting('thursday')).toBe('auto');
    expect(parseWeekStartSetting(null)).toBe('auto');
    expect(parseWeekStartSetting(7)).toBe('auto');
  });
});
