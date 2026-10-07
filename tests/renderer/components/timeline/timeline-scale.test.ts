/**
 * The Timeline's axis maths (#2608): zoom about an anchor, pan, clamping to
 * the drawable range (years −99,999..99,999), Fit (bounded by a range
 * filter), a stored range resolved against Fit, and ticks per zoom level with
 * `Intl` labels — never d3-time-format's `%Y`.
 */
import { describe, it, expect } from 'vitest';
import { civilMs } from '../../../../src/shared/objects/date-precision';
import { timelineDomain, timelineRangeFromDomain } from '../../../../src/shared/objects/timeline';
import {
  axisTicks, clampDomain, DRAWABLE_END, DRAWABLE_START, fitDomain, FIT_PADDING, MIN_DOMAIN_MS, panDomain, panToShow,
  resolveDomain, tickUnit, timeAt, xOf, zoomDomain,
} from '../../../../src/renderer/lib/components/timeline/timeline-scale';

const Y = (y: number) => civilMs(y, 0, 1);
const DAY = 86_400_000;

describe('zoomDomain / panDomain', () => {
  const d = { start: Y(1960), end: Y(1980) };

  it('zooms about the anchor, keeping the instant under it in place', () => {
    const z = zoomDomain(d, 2, 0.25);
    expect(z.end - z.start).toBeCloseTo((d.end - d.start) / 2);
    const pivot = d.start + (d.end - d.start) * 0.25;
    expect(z.start + (z.end - z.start) * 0.25).toBeCloseTo(pivot);
    // Zoom in then out by the same factor is where it started.
    const back = zoomDomain(z, 0.5, 0.25);
    expect(back.start).toBeCloseTo(d.start, -3);
    expect(back.end).toBeCloseTo(d.end, -3);
  });

  it('stops at the narrowest view rather than jumping', () => {
    const narrow = { start: civilMs(1969, 6, 20, 14), end: civilMs(1969, 6, 20, 14) + MIN_DOMAIN_MS };
    expect(zoomDomain(narrow, 4)).toEqual(narrow);
  });

  it('stops at the drawable range when zooming out, and pans no further than its edges', () => {
    const all = zoomDomain(d, 1e-9);
    expect(all).toEqual({ start: DRAWABLE_START, end: DRAWABLE_END });
    expect(panDomain(d, -1e18)).toEqual({ start: DRAWABLE_START, end: DRAWABLE_START + (d.end - d.start) });
    expect(panDomain(d, 1e18)).toEqual({ start: DRAWABLE_END - (d.end - d.start), end: DRAWABLE_END });
  });

  it('pans without resizing', () => {
    const p = panDomain(d, 5 * DAY);
    expect(p.end - p.start).toBe(d.end - d.start);
    expect(p.start).toBe(d.start + 5 * DAY);
  });

  it('panToShow moves the least needed, and leaves a visible span alone', () => {
    expect(panToShow(d, Y(1970), Y(1971))).toBe(d);
    const later = panToShow(d, Y(1990), Y(1991));
    expect(later.end).toBeGreaterThanOrEqual(Y(1991));
    expect(later.end - later.start).toBe(d.end - d.start);
    // Too long to fit: its start is shown.
    const long = panToShow(d, Y(1900), Y(2000));
    expect(long.start).toBeLessThan(Y(1900));
    expect(long.end).toBeGreaterThan(Y(1900));
  });

  it('xOf and timeAt are inverses', () => {
    expect(xOf(d.start, d, 800)).toBe(0);
    expect(xOf(d.end, d, 800)).toBe(800);
    expect(timeAt(xOf(Y(1969), d, 800), d, 800)).toBeCloseTo(Y(1969), -2);
  });

  it('clampDomain keeps a domain inside the drawable range at a legal width', () => {
    expect(clampDomain({ start: Y(-200_000), end: Y(-199_000) }).start).toBe(DRAWABLE_START);
    const tiny = clampDomain({ start: Y(1969), end: Y(1969) + 1 });
    expect(tiny.end - tiny.start).toBe(MIN_DOMAIN_MS);
  });
});

describe('zoom and pan round-trip through the stored range', () => {
  it('a zoomed or panned view, written and read back, covers what was shown', () => {
    let d = { start: Y(1960), end: Y(1976) };
    for (const step of [
      (x: typeof d) => zoomDomain(x, 3, 0.7),
      (x: typeof d) => panDomain(x, 40 * DAY),
      (x: typeof d) => zoomDomain(x, 200, 0.5),
      (x: typeof d) => zoomDomain(x, 40, 0.1), // below a day
      (x: typeof d) => panDomain(x, -3_600_000),
    ]) {
      d = step(d);
      const r = timelineRangeFromDomain(d.start, d.end);
      const back = timelineDomain(r);
      expect(back.start).toBeLessThanOrEqual(d.start);
      expect(back.end).toBeGreaterThanOrEqual(d.end);
      // …and not much more: a quarter at most (day rounding), a minute each side below that.
      expect(back.end! - back.start!).toBeLessThanOrEqual((d.end - d.start) * 1.25 + 2 * 60_000);
    }
  });
});

describe('fitDomain / resolveDomain', () => {
  const extent = { start: Y(1960), end: Y(1980) };

  it('fits the extent with padding each side', () => {
    const f = fitDomain(extent)!;
    expect(f.start).toBeCloseTo(Y(1960) - (Y(1980) - Y(1960)) * FIT_PADDING, -3);
    expect(f.end).toBeCloseTo(Y(1980) + (Y(1980) - Y(1960)) * FIT_PADDING, -3);
    expect(fitDomain(null)).toBeNull();
  });

  it('is bounded by a range filter\'s window, padding included', () => {
    const f = fitDomain({ start: Y(1960), end: Y(2000) }, { start: Y(1950), end: Y(1971) })!;
    expect(f.start).toBeLessThan(Y(1960)); // the events start inside the window: padded, but not past 1950
    expect(f.start).toBeGreaterThanOrEqual(Y(1950));
    expect(f.end).toBe(Y(1971)); // an event running past the window is cut at it
    const open = fitDomain({ start: Y(1960), end: Y(2000) }, { start: null, end: Y(1971) })!;
    expect(open.end).toBe(Y(1971));
  });

  it('a window the events don\'t meet fits the events', () => {
    expect(fitDomain(extent, { start: Y(2100), end: Y(2200) })).toEqual(fitDomain(extent));
  });

  it('resolves pinned sides as written and open sides from Fit', () => {
    const fit = fitDomain(extent)!;
    expect(resolveDomain({ start: Y(1965), end: Y(1970) }, fit)).toEqual({ start: Y(1965), end: Y(1970) });
    expect(resolveDomain({ start: Y(1965), end: null }, fit)).toEqual({ start: Y(1965), end: fit.end });
    expect(resolveDomain({ start: null, end: null }, fit)).toEqual(fit);
    // `from` after every event: keep `from`, at Fit's width.
    const late = resolveDomain({ start: Y(2100), end: null }, fit);
    expect(late.start).toBe(Y(2100));
    expect(late.end - late.start).toBeCloseTo(fit.end - fit.start, -3);
  });
});

describe('axisTicks', () => {
  const labels = (start: number, end: number, width = 1000) => axisTicks({ start, end }, width, { locale: 'en-GB' });

  it('adapts its unit to the zoom: centuries and decades, years, months, days, hours', () => {
    expect(labels(Y(1000), Y(2000)).unit).toBe('year');
    expect(labels(Y(1000), Y(2000)).ticks.map((t) => t.label)).toContain('1500');
    expect(labels(Y(1960), Y(2000)).ticks.map((t) => t.label)).toContain('1970');
    expect(labels(Y(1969), Y(1970)).unit).toBe('month');
    expect(labels(civilMs(1969, 6, 1), civilMs(1969, 7, 1)).unit).toBe('day');
    expect(labels(civilMs(1969, 6, 20), civilMs(1969, 6, 21)).unit).toBe('hour');
    expect(tickUnit(60_000)).toBe('minute');
  });

  it('carries the year (or day) on the first tick and where it turns over', () => {
    const m = labels(civilMs(1969, 9, 1), civilMs(1970, 3, 1)).ticks.map((t) => t.label);
    expect(m[0]).toBe('Oct 1969');
    expect(m).toContain('Jan 1970');
    expect(m).toContain('Nov');
    const h = labels(civilMs(1969, 6, 20, 18), civilMs(1969, 6, 21, 6)).ticks.map((t) => t.label);
    expect(h[0]).toBe('20 Jul, 18:00');
    expect(h).toContain('21 Jul, 00:00');
    expect(h).toContain('20:00');
  });

  it('labels through Intl: BC years with an era, five-digit years whole', () => {
    const bc = labels(Y(-100), Y(100)).ticks.map((t) => t.label);
    expect(bc).toContain('20 AD');
    expect(bc.join(' ')).not.toMatch(/-00/);
    const far = labels(Y(12000), Y(12100)).ticks.map((t) => t.label);
    expect(far).toContain('12050');
  });

  // #2698: d3 steps on round astronomical years (0 is 1 BC, −100 is 101 BC).
  // BC ticks must land on round historical years instead, with AD 1 as the boundary.
  const yearsOf = (start: number, end: number, width = 1000) => labels(start, end, width).ticks.map((t) => t.label);
  const roundBC = (l: string, every: number) => {
    const m = /^(\d+) BC$/.exec(l);
    return !m || Number(m[1]) % every === 0;
  };

  it('puts BC ticks on round historical years across the era boundary (#2698)', () => {
    const t = yearsOf(Y(-100), Y(100));
    expect(t).toContain('100 BC');
    expect(t).toContain('1 AD');
    expect(t).not.toContain('101 BC');
    expect(t).not.toContain('1 BC');
    expect(t.every((l) => roundBC(l, 20))).toBe(true);
    // AD ticks are unchanged: round multiples.
    expect(t.filter((l) => / AD$/.test(l) && l !== '1 AD').every((l) => Number(l.split(' ')[0]) % 20 === 0)).toBe(true);
    // In time order.
    const ts = labels(Y(-100), Y(100)).ticks.map((x) => x.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('puts ticks on round historical years for a wholly BCE range, and in deep time (#2698)', () => {
    const classical = yearsOf(Y(-500), Y(-100));
    expect(classical.length).toBeGreaterThan(3);
    expect(classical.every((l) => / BC$/.test(l))).toBe(true);
    expect(classical.every((l) => roundBC(l, 50))).toBe(true);
    expect(classical).toContain('500 BC');
    const deep = yearsOf(Y(-90000), Y(-10000));
    expect(deep.length).toBeGreaterThan(3);
    expect(deep.every((l) => roundBC(l, 1000))).toBe(true); // no "80001 BC"
  });

  it('leaves single-year and AD-only axes as d3 ticks them (#2698)', () => {
    // Every year: consecutive years read consecutively either way.
    expect(yearsOf(Y(-5), Y(5), 1500)).toContain('1 BC');
    // AD-only: unchanged round years, no era.
    expect(yearsOf(Y(1000), Y(2000))).toContain('1500');
  });

  it('ticks the whole drawable range', () => {
    const all = labels(DRAWABLE_START, DRAWABLE_END);
    expect(all.ticks.length).toBeGreaterThan(3);
    expect(all.unit).toBe('year');
  });
});
