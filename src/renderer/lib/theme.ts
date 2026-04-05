export type ThemeMode = 'dark' | 'light' | 'contrast' | 'system';

const STORAGE_KEY = 'themeMode';

export function getThemeMode(): ThemeMode {
  return (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'dark';
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
}

export function getEffectiveTheme(mode: ThemeMode): 'dark' | 'light' | 'contrast' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  const effective = getEffectiveTheme(mode);
  if (effective === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', effective);
  }
}

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

  // Listen for system theme changes when in 'system' mode
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemeMode() === 'system') {
      applyTheme('system');
    }
  });
}
