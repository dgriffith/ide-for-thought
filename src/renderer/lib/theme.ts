// ThemeMode + THEME_MODES live in shared/ so the native menu (main process)
// and the renderer draw from one list. Re-exported here so existing
// `../theme` imports keep working.
import { isPluginThemeMode, isThemeMode, type PluginTheme, type ThemeMode } from '../../shared/theme';
import { THEME_TOKENS } from '../../shared/theme-tokens';
export { THEME_MODES } from '../../shared/theme';
export type { ThemeMode };

const STORAGE_KEY = 'themeMode';
/** The chosen plugin theme, kept so it paints on launch before main has listed the plugins' themes. */
const CACHE_KEY = 'pluginThemeCache';
const STYLE_ID = 'minerva-plugin-themes';

// The enabled plugins' themes (#2787), set by the plugin-themes store. Null
// until main has answered: until then a chosen plugin theme paints from the
// cache, rather than flashing System and back.
let pluginThemes: PluginTheme[] | null = null;

function readCache(): PluginTheme | null {
  let t: PluginTheme | null = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) t = JSON.parse(raw) as PluginTheme;
  } catch {
    // Storage blocked, or the cache unreadable: it's only a cache, so the
    // theme paints once main lists the plugins' themes instead.
  }
  return t && typeof t === 'object' && isPluginThemeMode(String(t.mode)) ? t : null;
}

function writeCache(theme: PluginTheme | null): void {
  try {
    if (theme) localStorage.setItem(CACHE_KEY, JSON.stringify(theme));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* storage unavailable: no cache, just a later first paint */ }
}

/** The plugin theme a mode names, if it's available now. */
export function findPluginTheme(mode: ThemeMode): PluginTheme | null {
  if (!isPluginThemeMode(mode)) return null;
  if (pluginThemes === null) {
    const cached = readCache();
    return cached?.mode === mode ? cached : null;
  }
  return pluginThemes.find((t) => t.mode === mode) ?? null;
}

const SAFE_VALUE = /^[^;{}<>\\"']+$/;

/** One `:root[data-theme="plugin:…"]` block. Main checked every token and value; this re-checks the shape, since a block is CSS. */
export function pluginThemeCss(theme: PluginTheme): string {
  if (!isThemeMode(theme.mode)) return '';
  const known = new Set(THEME_TOKENS);
  const lines = Object.entries(theme.tokens)
    .filter(([k, v]) => known.has(k) && SAFE_VALUE.test(v))
    .map(([k, v]) => `  ${k}: ${v};`);
  return `:root[data-theme="${theme.mode}"] {\n${lines.join('\n')}\n}`;
}

function writeStyle(themes: PluginTheme[]): void {
  let el = document.getElementById(STYLE_ID);
  if (themes.length === 0) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = themes.map(pluginThemeCss).join('\n');
}

/** The plugin-themes store hands over the enabled plugins' themes. */
export function setPluginThemes(themes: PluginTheme[]): void {
  pluginThemes = themes;
  writeStyle(themes);
  // The cached copy follows the plugin's current version of the theme.
  const chosen = getThemeMode();
  const current = isPluginThemeMode(chosen) ? themes.find((t) => t.mode === chosen) : undefined;
  if (current) writeCache(current);
}

export function getThemeMode(): ThemeMode {
  // First-run default is 'system' so a fresh install matches the OS
  // appearance out of the box (#1140). Only applies with nothing stored;
  // once the user picks a theme, setThemeMode persists that choice. A stored
  // value that isn't a theme mode reads as 'system' too.
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* none */ }
  return isThemeMode(stored) ? stored : 'system';
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  writeCache(findPluginTheme(mode));
  applyTheme(mode);
}

/**
 * Dark, light or contrast: what code that branches on the theme should use.
 * A plugin theme answers with its base; one whose plugin is gone answers as
 * System, which is what's on screen.
 */
export function getEffectiveTheme(mode: ThemeMode): 'dark' | 'light' | 'contrast' {
  if (isPluginThemeMode(mode)) {
    const theme = findPluginTheme(mode);
    return theme ? theme.base : getEffectiveTheme('system');
  }
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return mode;
}

/**
 * Applied mode, as a cache key: two plugin themes with the same base differ
 * here, where `getEffectiveTheme` would say "dark" for both.
 */
export function getAppliedThemeKey(mode: ThemeMode): string {
  return findPluginTheme(mode)?.mode ?? getEffectiveTheme(mode);
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  const plugin = findPluginTheme(mode);
  if (plugin) {
    if (pluginThemes === null) writeStyle([plugin]);
    root.setAttribute('data-theme', plugin.mode);
    // A light-based theme inherits the light theme's tokens (global.css
    // matches [data-theme-base="light"] beside [data-theme="light"]).
    if (plugin.base === 'light') root.setAttribute('data-theme-base', 'light');
    else root.removeAttribute('data-theme-base');
    return;
  }
  root.removeAttribute('data-theme-base');
  // A plugin theme that's gone (its plugin turned off or removed) shows
  // System, without forgetting the choice: turning the plugin back on brings
  // it back.
  const effective = getEffectiveTheme(isPluginThemeMode(mode) ? 'system' : mode);
  if (effective === 'dark') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', effective);
  }
}

/** ⌘⇧T cycles the built-ins only; from a plugin theme it goes to Dark. */
export function cycleTheme(): ThemeMode {
  const current = getThemeMode();
  const next: ThemeMode =
    current === 'dark' ? 'light'
    : current === 'light' ? 'contrast'
    : current === 'contrast' ? 'system'
    : 'dark';
  setThemeMode(next);
  return next;
}

/** Initialize theme on app load and listen for system changes */
export function initTheme(): void {
  const mode = getThemeMode();
  applyTheme(mode);

  // Listen for system theme changes when System is what's showing — chosen,
  // or standing in for a plugin theme that's gone.
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    const now = getThemeMode();
    if (now === 'system' || (isPluginThemeMode(now) && !findPluginTheme(now))) {
      applyTheme(now);
    }
  });
}
