/**
 * The colour themes enabled plugins contribute (#2787), for the theme
 * pickers: the status bar, Settings → Appearance and the command palette.
 * The native menu reads main's own copy.
 *
 * On a refresh it hands the list to `theme.ts` and re-applies the chosen
 * theme, so a theme appears, changes or (its plugin turned off) gives way to
 * System live, then tells App so canvases and editors re-tint too.
 */
import { api } from '../ipc/client';
import { THEME_MODES, isPluginThemeMode, type PluginTheme, type PluginThemeList, type ThemeMode } from '../../../shared/theme';
import { applyTheme, getThemeMode, setPluginThemes } from '../theme';
import { logger } from '../../../shared/logger';

let themes = $state<PluginTheme[]>([]);
let problems = $state<PluginThemeList['problems']>([]);
const applied = new Set<() => void>();

async function refresh(): Promise<void> {
  try {
    const list = await api.plugins.themes();
    themes = list.themes;
    problems = list.problems;
    setPluginThemes(list.themes);
    applyTheme(getThemeMode());
    for (const cb of applied) cb();
  } catch (e) {
    logger('plugins').warn('loading plugin themes failed:', e);
  }
}

/** One entry in a theme picker. */
export interface ThemeOption {
  value: ThemeMode;
  label: string;
  /** The plugin it comes from, for a plugin theme. */
  plugin?: string;
}

export const pluginThemesStore = {
  get themes() { return themes; },
  /** Every theme a picker lists: the built-ins, then the plugins'. */
  get options(): ThemeOption[] {
    return [
      ...THEME_MODES.map((m) => ({ value: m.value, label: m.label })),
      ...themes.map((t) => ({ value: t.mode, label: t.label, plugin: t.plugin.name })),
    ];
  },
  /** A mode's name; a plugin theme that's gone shows as the System it falls back to. */
  labelFor(mode: ThemeMode): string {
    const builtin = THEME_MODES.find((m) => m.value === mode);
    if (builtin) return builtin.label;
    const t = isPluginThemeMode(mode) ? themes.find((x) => x.mode === mode) : undefined;
    return t ? t.label : 'System';
  },
  /** Theme files a plugin ships that couldn't be used, with why. */
  get problems() { return problems; },
  refresh,
  /** Run after a refresh re-applied the theme. Returns an unsubscribe. */
  onApplied(cb: () => void): () => void {
    applied.add(cb);
    return () => applied.delete(cb);
  },
};
