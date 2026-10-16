/**
 * Theme modes shared across processes. The renderer's status-bar picker,
 * command palette, and Settings → Appearance, plus the native View → Theme
 * submenu, all draw from this one list so labels can't drift between surfaces.
 *
 * Plugins add themes (#2787): `plugin:<plugin id>/<theme id>`, listed after
 * the built-ins. A plugin theme is colours over a built-in `base`, so code
 * that needs to know dark or light reads the base.
 */
import type { PluginOrigin } from './plugins/format';

export type BuiltinThemeMode = 'dark' | 'light' | 'contrast' | 'system';
/** A plugin theme's mode: `plugin:<plugin id>/<theme id>`. */
export type PluginThemeMode = `plugin:${string}`;
export type ThemeMode = BuiltinThemeMode | PluginThemeMode;

export const THEME_MODES: { value: BuiltinThemeMode; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'contrast', label: 'High Contrast' },
  { value: 'system', label: 'System' },
];

/** A theme a plugin contributes, checked and ready to apply. */
export interface PluginTheme {
  mode: PluginThemeMode;
  label: string;
  /** What everything the theme leaves out comes from, and what dark/light consumers see. */
  base: 'dark' | 'light';
  /** Token → value, each checked against `THEME_TOKENS` and the value grammar. */
  tokens: Record<string, string>;
  plugin: PluginOrigin;
  /** Text/background pairs below WCAG AA — reported, not refused. */
  warnings: string[];
}

/** What main answers for the theme list: the themes, and the files it couldn't use. */
export interface PluginThemeList {
  themes: PluginTheme[];
  problems: Array<{ plugin: string; file: string; problem: string }>;
}

export function pluginThemeMode(pluginId: string, themeId: string): PluginThemeMode {
  return `plugin:${pluginId}/${themeId}`;
}

export function isPluginThemeMode(mode: string): mode is PluginThemeMode {
  return mode.startsWith('plugin:');
}

export function isThemeMode(mode: unknown): mode is ThemeMode {
  return typeof mode === 'string'
    && (THEME_MODES.some((m) => m.value === mode) || /^plugin:[a-z][a-z0-9-]*\/[A-Za-z0-9_-]+$/.test(mode));
}
