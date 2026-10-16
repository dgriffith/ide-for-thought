/**
 * Colour themes from plugins (#2787). A plugin's `themes/<id>.json`:
 *
 * ```json
 * { "label": "Solarized Dark", "base": "dark",
 *   "tokens": { "--bg": "#002b36", "--text": "#839496", "--accent": "#268bd2" } }
 * ```
 *
 * Tokens only, and only the ones the built-in themes define
 * (`shared/theme-tokens.ts`); values only colours, a `var()` of another
 * token, or `none`. No `url()`, no `@import`, no selectors — a theme
 * recolours Minerva, it can't restyle or hide anything. A file that breaks a
 * rule is refused on its own and reported, naming the rule; the plugin's
 * other themes still load.
 *
 * Contrast is checked, not enforced: text/surface pairs below WCAG AA are
 * warnings carried on the theme.
 *
 * Read synchronously and memoized on the plugin scan's version, because the
 * native menu lists themes and is rebuilt on a hot path (#2221).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PluginTheme, PluginThemeList } from '../../shared/theme';
import { pluginThemeMode } from '../../shared/theme';
import { THEME_CONTRAST_PAIRS, THEME_TOKEN_ALIASES, THEME_TOKENS } from '../../shared/theme-tokens';
import { logger } from '../../shared/logger';
import { contributionsTo, loadedPluginScan, pluginScanVersion } from './registry';

const MAX_FILE_BYTES = 64 * 1024;
const MAX_VALUE = 120;
const THEME_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KNOWN = new Set(THEME_TOKENS);

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:%|deg|rad|turn)?`;
const ARGS = String.raw`(?:${NUM}|none)(?:\s*[,/]?\s*(?:${NUM}|none)){1,4}`;
const COLOUR_FN = new RegExp(String.raw`^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*${ARGS}\s*\)$`, 'i');
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const KEYWORD = /^(?:[a-z]{3,20})$/i;
const VAR = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i;

/** Why a token value isn't allowed, or null when it is. */
export function themeValueProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be a string';
  const v = value.trim();
  if (v.length === 0 || v.length > MAX_VALUE) return `must be 1 to ${MAX_VALUE} characters`;
  if (HEX.test(v) || COLOUR_FN.test(v) || KEYWORD.test(v)) return null;
  const alias = VAR.exec(v);
  if (alias) return KNOWN.has(alias[1]!) ? null : `refers to "${alias[1]}", which isn't a theme token`;
  return 'must be a colour: #hex, rgb(), hsl(), oklch() and the like, a colour name, or var(--token)';
}

/** Read one theme file's JSON into a theme, or every problem with it. */
export function parseThemeFile(
  raw: unknown,
  ids: { plugin: string; theme: string },
): { ok: true; theme: Omit<PluginTheme, 'plugin'> } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problems: ['must be a JSON object with "label", "base" and "tokens"'] };
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!['label', 'base', 'tokens', '$schema'].includes(k)) problems.push(`unknown field "${k}"`);
  if (!THEME_ID.test(ids.theme)) problems.push('the file name must be letters, digits, "-" and "_"');
  const label = typeof r.label === 'string' && r.label.trim() && r.label.length <= 60 ? r.label.trim() : null;
  if (!label) problems.push('"label" must be a name of at most 60 characters');
  const base = r.base === 'dark' || r.base === 'light' ? r.base : null;
  if (!base) problems.push('"base" is required: "dark" or "light"');
  const tokens: Record<string, string> = {};
  if (r.tokens === null || typeof r.tokens !== 'object' || Array.isArray(r.tokens)) {
    problems.push('"tokens" must be an object of token → colour');
  } else {
    for (const [token, value] of Object.entries(r.tokens)) {
      if (!KNOWN.has(token)) { problems.push(`unknown token "${token}"`); continue; }
      const why = themeValueProblem(value);
      if (why) problems.push(`"${token}" ${why}`);
      else tokens[token] = (value as string).trim();
    }
    if (Object.keys(r.tokens).length === 0) problems.push('"tokens" is empty');
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    theme: { mode: pluginThemeMode(ids.plugin, ids.theme), label: label!, base: base!, tokens, warnings: contrastWarnings(tokens) },
  };
}

// ── Contrast (WCAG 2.x) ────────────────────────────────────────────────────

/** sRGB 0-255, for the colours a check can read: #hex and rgb(). Others aren't measured. */
function rgbOf(value: string): [number, number, number] | null {
  const hex = HEX.exec(value) ? value.slice(1) : null;
  if (hex) {
    const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((c) => c + c).join('') : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const m = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/i.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number | null {
  const ca = rgbOf(a);
  const cb = rgbOf(b);
  if (!ca || !cb) return null;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A token's value in this theme, following its own `var()`s and `:root`'s aliases. */
function resolve(tokens: Record<string, string>, token: string, depth = 0): string | null {
  if (depth > 8) return null;
  const v = tokens[token];
  if (v !== undefined) {
    const alias = VAR.exec(v);
    return alias ? resolve(tokens, alias[1]!, depth + 1) : v;
  }
  const inherited = THEME_TOKEN_ALIASES[token];
  return inherited ? resolve(tokens, inherited, depth + 1) : null;
}

/**
 * Each text/surface pair the app uses that falls below AA (4.5:1), when the
 * theme sets both colours in a form that can be measured. A pair the theme
 * leaves to its base keeps the base's colours, which are checked already.
 */
export function contrastWarnings(tokens: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [text, surface] of THEME_CONTRAST_PAIRS) {
    const t = resolve(tokens, text);
    const s = resolve(tokens, surface);
    if (t === null || s === null) continue;
    const ratio = contrastRatio(t, s);
    if (ratio !== null && ratio < 4.5) out.push(`${text} on ${surface} is ${ratio.toFixed(2)}:1, below the 4.5:1 WCAG AA asks for text`);
  }
  return out;
}

// ── Loading ────────────────────────────────────────────────────────────────

let memo: { version: number; list: PluginThemeList } | null = null;

/** The enabled plugins' themes, from the last finished plugin scan. */
export function pluginThemes(): PluginThemeList {
  const version = pluginScanVersion();
  if (memo?.version === version) return memo.list;
  const list: PluginThemeList = { themes: [], problems: [] };
  for (const { plugin, contribution } of contributionsTo(loadedPluginScan(), 'themes')) {
    const id = plugin.manifest.id;
    const theme = path.basename(contribution.path, path.extname(contribution.path));
    const refuse = (problem: string) => {
      list.problems.push({ plugin: id, file: contribution.path, problem });
      logger('plugins').warn(`${id}: theme ${contribution.path} skipped: ${problem}`);
    };
    let raw: unknown;
    try {
      const st = fs.statSync(contribution.absolutePath);
      if (st.size > MAX_FILE_BYTES) { refuse(`it's ${st.size} bytes; a theme may be at most ${MAX_FILE_BYTES}`); continue; }
      raw = JSON.parse(fs.readFileSync(contribution.absolutePath, 'utf-8'));
    } catch (e) {
      refuse(e instanceof SyntaxError ? `it isn't valid JSON (${e.message})` : `it couldn't be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
      continue;
    }
    const r = parseThemeFile(raw, { plugin: id, theme });
    if (!r.ok) { refuse(r.problems.join('; ')); continue; }
    list.themes.push({ ...r.theme, plugin: { id, name: plugin.manifest.name, version: plugin.manifest.version } });
  }
  memo = { version, list };
  return list;
}
