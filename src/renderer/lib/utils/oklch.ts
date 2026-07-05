/**
 * oklch() → sRGB hex conversion.
 *
 * The app's theme tokens (`global.css`) are authored in `oklch()` (CSS Color 4)
 * for a wide-gamut, perceptually-uniform palette. Chromium renders them fine,
 * but some downstream color libraries we hand computed token values to — notably
 * mermaid's `khroma` — can't parse `oklch()` and throw "Unsupported color
 * format". Converting a token to a plain sRGB hex string keeps those libraries
 * working while the CSS keeps its oklch authoring.
 *
 * Done with explicit math (Björn Ottosson's OKLab conversion) rather than a
 * canvas / getComputedStyle round-trip: Electron's canvas color parser doesn't
 * reliably normalize `oklch()`, which left an earlier canvas-based attempt at
 * this fix still broken.
 */

const OKLCH_RE = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/i;

/**
 * Convert an `oklch(...)` color string to an sRGB `#rrggbb`. Any other color
 * format (hex, `rgb()`, named, …) is returned unchanged — the consumer's own
 * parser is assumed to handle those.
 */
export function normalizeColor(input: string): string {
  const m = OKLCH_RE.exec(input.trim());
  if (!m) return input;
  const L = m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  const C = parseFloat(m[3]);
  const H = parseFloat(m[4]);
  return oklchToHex(L, C, H);
}

/**
 * oklch(L C H) → sRGB `#rrggbb`. L in [0,1] (lightness), C ≥ 0 (chroma), H in
 * degrees (hue). Out-of-sRGB-gamut results are clamped per channel.
 */
export function oklchToHex(L: number, C: number, H: number): string {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  // OKLab → non-linear LMS → LMS.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS → linear-light sRGB.
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return '#' + [r, g, bl].map(channelToHex).join('');
}

/** Linear-light sRGB channel → gamma-encoded 2-digit hex byte (clamped 0–255). */
function channelToHex(c: number): string {
  const enc = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const byte = Math.max(0, Math.min(255, Math.round(enc * 255)));
  return byte.toString(16).padStart(2, '0');
}
