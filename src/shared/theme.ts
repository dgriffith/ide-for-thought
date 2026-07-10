/**
 * Theme modes shared across processes. The renderer's status-bar picker,
 * command palette, and Settings → Appearance, plus the native View → Theme
 * submenu, all draw from this one list so labels can't drift between surfaces.
 */
export type ThemeMode = 'dark' | 'light' | 'contrast' | 'system';

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'contrast', label: 'High Contrast' },
  { value: 'system', label: 'System' },
];
