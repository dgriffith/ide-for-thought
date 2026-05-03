/**
 * Sidebar / file-explorer behavior settings (#460).
 *
 * Mirrors the synchronous-snapshot pattern used by refactor/settings.ts —
 * a tiny wrapper around localStorage that the SettingsDialog writes
 * through and Sidebar.svelte reads from.
 */

export interface SidebarSettings {
  /** Auto-reveal the active file in the tree when it changes (#460). */
  autoReveal: boolean;
}

export const DEFAULT_SIDEBAR_SETTINGS: SidebarSettings = {
  autoReveal: true,
};

const STORAGE_KEY = 'sidebarSettings';

function readFromStorage(): SidebarSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SIDEBAR_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIDEBAR_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SidebarSettings> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SIDEBAR_SETTINGS };
    return { ...DEFAULT_SIDEBAR_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SIDEBAR_SETTINGS };
  }
}

let settings: SidebarSettings = readFromStorage();

export function getSidebarSettings(): SidebarSettings {
  return settings;
}

export function setSidebarSettings(patch: Partial<SidebarSettings>): SidebarSettings {
  settings = { ...settings, ...patch };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
  return settings;
}

export function __resetSidebarSettingsForTests(): void {
  settings = readFromStorage();
}
