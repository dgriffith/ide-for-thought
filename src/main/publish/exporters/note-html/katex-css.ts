/**
 * Inline-fonts KaTeX CSS for the note-html exporter (#327).
 *
 * Resolves the trade-off documented in style.ts: HTML exports promise
 * single self-contained artifacts (no external URLs, no asset
 * directories), and KaTeX needs a 24KB stylesheet + 20 woff2 fonts to
 * render. We inline the lot — ~300KB per math-bearing export — and
 * gate the cost on the body actually containing KaTeX output (no math
 * → no CSS shipped).
 *
 * The `inlineFonts: false` mode (per the issue's flag) drops the
 * @font-face declarations entirely so KaTeX falls back to system serif.
 * Math reads legibly, just without the Computer-Modern feel.
 *
 * CSS is read from `node_modules/katex/dist/katex.min.css` once per
 * process and cached in module state. Fonts likewise — the substitution
 * is O(file size) but only fires the first time getKatexStyle() runs.
 */

import fs from 'node:fs';
import path from 'node:path';

let cachedFull: string | null = null;
let cachedNoFonts: string | null = null;

export interface KatexStyleOptions {
  /** Inline the woff2 font subset as base64 data URLs. Default true. */
  inlineFonts?: boolean;
}

export function getKatexStyle(opts: KatexStyleOptions = {}): string {
  const inlineFonts = opts.inlineFonts !== false;
  if (inlineFonts) {
    if (cachedFull !== null) return cachedFull;
    cachedFull = buildStyle(true);
    return cachedFull;
  }
  if (cachedNoFonts !== null) return cachedNoFonts;
  cachedNoFonts = buildStyle(false);
  return cachedNoFonts;
}

/**
 * Quick heuristic: does this rendered HTML actually contain KaTeX
 * output? Used to skip shipping the 300KB stylesheet on exports that
 * contain no math. Looks for the `.katex` class which KaTeX wraps
 * every rendered formula in.
 */
export function bodyHasKatex(html: string): boolean {
  return /class="(?:[^"]*\s)?katex(?:\s|"|-)/.test(html);
}

function buildStyle(inlineFonts: boolean): string {
  const katexDir = resolveKatexDir();
  const cssPath = path.join(katexDir, 'katex.min.css');
  let css = fs.readFileSync(cssPath, 'utf8');

  if (!inlineFonts) {
    // Strip every @font-face declaration. KaTeX falls back to the
    // outer document's serif stack; math is legible if not pretty.
    css = css.replace(/@font-face\s*\{[^}]*\}/g, '');
    return css;
  }

  // For each `url(fonts/X.woff2)` reference: read the file, base64-
  // encode it, swap in the data URL. Then drop the alternate-format
  // fallbacks (woff, ttf) which would 404 in a standalone HTML.
  const fontsDir = path.join(katexDir, 'fonts');
  css = css.replace(
    /url\(fonts\/(KaTeX_[A-Za-z0-9_-]+)\.woff2\)/g,
    (_match, name: string) => {
      const fontPath = path.join(fontsDir, `${name}.woff2`);
      const bytes = fs.readFileSync(fontPath);
      return `url(data:font/woff2;base64,${bytes.toString('base64')})`;
    },
  );
  // Strip alternate-format fallbacks left over after the woff2 URL.
  // The `src:` declaration shape is:
  //   url(data:...) format("woff2"),url(fonts/X.woff) format("woff"),url(fonts/X.ttf) format("truetype")
  // We want to keep only the woff2 part. Drop everything from the
  // first `,url(fonts/` up to the trailing `format("truetype")`.
  css = css.replace(
    /,url\(fonts\/[^)]+\.woff\)\s*format\("woff"\),url\(fonts\/[^)]+\.ttf\)\s*format\("truetype"\)/g,
    '',
  );
  return css;
}

/**
 * Locate the katex package's `dist` directory. In dev + tests this is
 * a plain `node_modules` lookup; in the packaged Electron build the
 * package lands under `app.asar/node_modules` which `require.resolve`
 * still handles correctly.
 */
function resolveKatexDir(): string {
  // require.resolve resolves to the file the package "main" / "module"
  // points at; we want the directory above. katex's main is
  // `dist/katex.js`, so two dirname's get us to `katex/`.
  const main = require.resolve('katex');
  return path.join(path.dirname(main));
}
