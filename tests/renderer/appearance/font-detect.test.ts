/**
 * Font-availability heuristic (#...). The canvas measurement itself needs a real
 * browser + real installed fonts, so these tests exercise the pure comparison
 * core (`isFontInstalledWith`) with injected width measurements: a family reads
 * as installed iff, against at least one generic baseline, the probe measured in
 * that family differs from the baseline alone.
 */
import { describe, it, expect } from 'vitest';
import { isFontInstalledWith, type Measure } from '../../../src/renderer/lib/appearance/font-detect';

// Baseline widths for the three generics the detector compares against.
const BASE: Record<string, number> = { monospace: 100, 'sans-serif': 110, serif: 120 };

/** Which generic keyword a CSS `font` shorthand ends with. Checks 'sans-serif'
 *  before 'serif' since the former contains the latter. */
function generic(font: string): 'monospace' | 'sans-serif' | 'serif' {
  if (font.includes('sans-serif')) return 'sans-serif';
  if (font.includes('monospace')) return 'monospace';
  return 'serif';
}

/** A measurer where `family` is installed and renders at a distinct width. */
function installedMeasure(family: string, appliedWidth = 199): Measure {
  return (font) => (font.includes(`"${family}"`) ? appliedWidth : BASE[generic(font)]!);
}

/** A measurer where any named family falls through to the generic baseline. */
const missingMeasure: Measure = (font) => BASE[generic(font)]!;

describe('isFontInstalledWith', () => {
  it('reports installed when the family renders differently from every baseline', () => {
    expect(isFontInstalledWith(installedMeasure('JetBrains Mono'), 'JetBrains Mono')).toBe(true);
  });

  it('reports not installed when the family matches the baseline for all generics', () => {
    expect(isFontInstalledWith(missingMeasure, 'Berkeley Mono')).toBe(false);
  });

  it('still reports installed when the family coincides with only one generic default', () => {
    // Same width as the monospace baseline (system default mono == the family),
    // but distinct against sans-serif and serif — the `.some` across baselines
    // must catch it.
    const measure: Measure = (font) => {
      if (font.includes('"Coincident Mono"')) {
        return generic(font) === 'monospace' ? BASE.monospace! : 175;
      }
      return BASE[generic(font)]!;
    };
    expect(isFontInstalledWith(measure, 'Coincident Mono')).toBe(true);
  });

  it('quotes the family into the shorthand (so multi-word names measure correctly)', () => {
    const seen: string[] = [];
    const measure: Measure = (font) => { seen.push(font); return BASE[generic(font)]!; };
    isFontInstalledWith(measure, 'JetBrains Mono');
    expect(seen).toContain('72px "JetBrains Mono", monospace');
    expect(seen).toContain('72px monospace');
  });
});
