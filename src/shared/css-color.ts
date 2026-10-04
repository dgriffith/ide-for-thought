/**
 * A CSS colour value that is ONLY a colour (#2561).
 *
 * Type definitions travel with the thoughtbase, and their `color:` lands in
 * `style` attributes (`color:${type.color}`) across the renderer. Escaping
 * stops attribute breakout but not CSS injection inside the attribute:
 * `red; position: fixed; inset: 0` overlays the app, `red; background:
 * url(https://…)` phones home. So a colour must match a colour grammar:
 * a hex colour, a bare named colour, or an `rgb[a]()` / `hsl[a]()` call over
 * numbers, percentages and separators — nothing else.
 */
const CSS_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]{3,30}|(?:rgba?|hsla?)\(\s*[-+0-9.%\s,/]+\s*\))$/i;

/** `value` trimmed, if it is purely a CSS colour; otherwise undefined. */
export function safeCssColor(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return CSS_COLOR.test(v) ? v : undefined;
}
