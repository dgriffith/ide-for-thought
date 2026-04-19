/**
 * Settings for the note-refactoring commands (#123, #125).
 *
 * Stored in localStorage. Planners read the current snapshot via
 * getRefactorSettings() — synchronous, returns plain data. The Svelte
 * SettingsDialog owns the reactive UI state and writes through to this
 * module on every change.
 */

export type DestinationMode = 'same-folder' | 'root' | 'custom';

export interface RefactorSettings {
  /** Where new notes from extract / split / split-by-heading land. */
  destination: DestinationMode;
  /**
   * Used when destination === 'custom'. Supports template tokens
   * ({{date:YYYY}}, {{title}}, etc.). Rendered at refactor time.
   * Empty string is treated as the thoughtbase root.
   */
  destinationTemplate: string;
  /**
   * Prepended to auto-generated filenames. Supports the same tokens.
   * Empty by default.
   */
  filenamePrefix: string;
  /**
   * When true, heading levels in an extracted body are shifted so the
   * shallowest level becomes H1. Doesn't affect the source note (#125).
   */
  normalizeHeadings: boolean;
}

export const DEFAULT_REFACTOR_SETTINGS: RefactorSettings = {
  destination: 'same-folder',
  destinationTemplate: '',
  filenamePrefix: '',
  normalizeHeadings: false,
};

const STORAGE_KEY = 'refactorSettings';

function readFromStorage(): RefactorSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_REFACTOR_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_REFACTOR_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_REFACTOR_SETTINGS };
    return { ...DEFAULT_REFACTOR_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_REFACTOR_SETTINGS };
  }
}

let settings: RefactorSettings = readFromStorage();

/** Synchronous snapshot for planners. Always returns the latest persisted values. */
export function getRefactorSettings(): RefactorSettings {
  return settings;
}

/** Write-through update — the SettingsDialog calls this on every change. */
export function setRefactorSettings(patch: Partial<RefactorSettings>): RefactorSettings {
  settings = { ...settings, ...patch };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
  return settings;
}

/** Test-only: re-read from storage / reset to defaults. */
export function __resetRefactorSettingsForTests(): void {
  settings = readFromStorage();
}
