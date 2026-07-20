/**
 * Best-effort detection of whether a *locally installed* font face is available
 * (#...). The named mono presets (JetBrains Mono, Berkeley Mono) only set a
 * font-family preference — if the face isn't installed, the browser silently
 * falls through to a fallback. This lets the Appearance panel surface a soft
 * "doesn't appear to be installed" hint instead of leaving it invisible.
 *
 * `document.fonts.check()` is NOT usable here: it only reports fonts in the
 * FontFaceSet (@font-face / loaded web fonts), and Minerva bundles none — every
 * preset is a system-font name. So we use the classic canvas text-metrics
 * heuristic: render a probe string in `"<family>", <generic>` and compare its
 * measured width against the generic alone. If the family actually applied, the
 * width differs from the fallback for at least one generic baseline; if it fell
 * through, the widths match. It's a heuristic — a face whose metrics happen to
 * match the fallback can read as "absent" — so callers must treat a negative as
 * a soft hint, never a hard error.
 */

/** Generic families to compare against; the `.some` across all three covers the
 *  case where the target font coincides with one generic's platform default. */
const BASELINES = ['monospace', 'sans-serif', 'serif'] as const;
/** Glyph-varied + long so per-glyph advance differences accumulate; large size
 *  amplifies them. */
const PROBE = 'mmmmmmmmmmlliwWi0O1234567890';
const SIZE = 72;

/** Measures the rendered width of the probe string for a CSS `font` shorthand. */
export type Measure = (cssFont: string) => number;

/**
 * Pure core: given a width-measuring function, is `family` installed? True when,
 * against at least one generic baseline, the probe measured in that family
 * differs from the baseline alone.
 */
export function isFontInstalledWith(measure: Measure, family: string): boolean {
  return BASELINES.some((base) => {
    const baseline = measure(`${SIZE}px ${base}`);
    const withFamily = measure(`${SIZE}px "${family}", ${base}`);
    return withFamily !== baseline;
  });
}

/** A canvas-backed measurer, or null when no 2D canvas is available. */
function canvasMeasurer(): Measure | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return (cssFont) => {
    ctx.font = cssFont;
    return ctx.measureText(PROBE).width;
  };
}

/**
 * Whether `family` appears to be installed on this system. Returns `true` when
 * detection can't run (no canvas), so we never nag on a false negative.
 */
export function isFontInstalled(family: string): boolean {
  try {
    const measure = canvasMeasurer();
    if (!measure) return true;
    return isFontInstalledWith(measure, family);
  } catch {
    return true;
  }
}
