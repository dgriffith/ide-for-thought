/**
 * Renderer-side access to the formatter's per-rule enable + config map (#153).
 * Stored in localStorage, read synchronously before each format run.
 * The settings UI (#154) will write through the same module.
 *
 * No rules are registered yet \u2014 the default settings intentionally leave
 * everything disabled so "Format" is a no-op until the user opts into
 * specific rules as they land.
 */

import type { FormatSettings } from '../../../shared/formatter/engine';
import { DEFAULT_FORMAT_SETTINGS } from '../../../shared/formatter/engine';

const STORAGE_KEY = 'formatSettings';

function readFromStorage(): FormatSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_FORMAT_SETTINGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FORMAT_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FORMAT_SETTINGS };
    return {
      enabled: (parsed.enabled && typeof parsed.enabled === 'object') ? parsed.enabled : {},
      configs: (parsed.configs && typeof parsed.configs === 'object') ? parsed.configs : {},
    };
  } catch {
    return { ...DEFAULT_FORMAT_SETTINGS };
  }
}

let settings: FormatSettings = readFromStorage();

export function getFormatSettings(): FormatSettings {
  return settings;
}

export function setFormatSettings(patch: Partial<FormatSettings>): FormatSettings {
  settings = {
    enabled: { ...settings.enabled, ...(patch.enabled ?? {}) },
    configs: { ...settings.configs, ...(patch.configs ?? {}) },
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
  return settings;
}

/** Test-only: re-read from storage / reset to defaults. */
export function __resetFormatSettingsForTests(): void {
  settings = readFromStorage();
}
