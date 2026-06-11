import { describe, it, expect } from 'vitest';
import {
  formatCreators,
  formatDueStamp,
  isOverdue,
  statusGlyph,
  statusTitle,
} from '../../src/renderer/lib/sources/source-display';

// Pure display helpers behind the SourceListItem split (#672). The date
// helpers depend on "today", so those cases use offsets from the current date
// rather than hard-coded strings.

const isoDaysFromNow = (days: number): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
    expect(isOverdue(isoDaysFromNow(-1))).toBe(true);
    expect(isOverdue(isoDaysFromNow(0))).toBe(false); // due today is not overdue
    expect(isOverdue(isoDaysFromNow(3))).toBe(false);
  });
});

describe('formatDueStamp', () => {
  it('falls back to the raw string for an unparseable date', () => {
    expect(formatDueStamp('garbage')).toBe('garbage');
  });

  it('omits the year for an in-current-year date, includes it otherwise', () => {
    const thisYear = new Date().getFullYear();
    const inYear = formatDueStamp(`${thisYear}-06-15`);
    expect(inYear).not.toMatch(String(thisYear)); // "Jun 15", no year
    const otherYear = formatDueStamp(`${thisYear + 2}-06-15`);
    expect(otherYear).toMatch(String(thisYear + 2)); // "Jun 15 2027"
  });
});
