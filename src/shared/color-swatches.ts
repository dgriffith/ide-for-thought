/**
 * The app's shared accent-colour vocabulary, as pickable swatches.
 *
 * These are the same Catppuccin accents the link-type palette already draws
 * from (`link-types.ts`), so a user-chosen type colour sits in the same family
 * as the colours Minerva assigns itself. Hex rather than the theme's `oklch`
 * tokens on purpose: a type's colour is durable user content written to
 * frontmatter and fed to `<input type="color">`, not a theme token that should
 * shift between light and dark.
 */
export interface ColorSwatch {
  /** Human name, used as the swatch's tooltip + accessible label. */
  name: string;
  /** Lowercase `#rrggbb`. */
  hex: string;
}

export const COLOR_SWATCHES: readonly ColorSwatch[] = [
  { name: 'Rosewater', hex: '#f5e0dc' },
  { name: 'Flamingo', hex: '#f2cdcd' },
  { name: 'Pink', hex: '#f5c2e7' },
  { name: 'Mauve', hex: '#cba6f7' },
  { name: 'Red', hex: '#f38ba8' },
  { name: 'Maroon', hex: '#eba0ac' },
  { name: 'Peach', hex: '#fab387' },
  { name: 'Yellow', hex: '#f9e2af' },
  { name: 'Green', hex: '#a6e3a1' },
  { name: 'Teal', hex: '#94e2d5' },
  { name: 'Sky', hex: '#89dceb' },
  { name: 'Sapphire', hex: '#74c7ec' },
  { name: 'Blue', hex: '#89b4fa' },
  { name: 'Lavender', hex: '#b4befe' },
  { name: 'Grey', hex: '#9399b2' },
];

/** The swatch shown by `<input type="color">` when no colour is set yet. */
export const DEFAULT_SWATCH = '#89b4fa';

/**
 * Normalize a user-typed colour to the `#rrggbb` an `<input type="color">`
 * requires, or null if it isn't one. Accepts the `#rgb` shorthand (expanding
 * it) and tolerates surrounding whitespace / a missing `#`.
 */
export function toHex6(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/.test(v)) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  return null;
}
