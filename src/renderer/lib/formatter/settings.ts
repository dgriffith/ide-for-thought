/**
 * Renderer-side access to the formatter\u2019s per-rule enable + config map (#154).
 * Persisted project-scoped in `.minerva/formatter.json` via main-side IPC.
 * The renderer keeps a synchronous snapshot in memory so the engine-facing
 * code (and the active-note format handler) can pull settings without an
 * async round-trip on every invocation.
 *
 * Flow:
 *   1. App.svelte calls `loadFormatSettings()` once the project opens.
 *   2. Synchronous consumers read via `getFormatSettings()`.
 *   3. The Formatter settings tab writes via `setFormatSettings(patch)`,
 *      which updates the cache and fires an IPC save (fire-and-forget).
 */

import { api } from '../ipc/client';
import type { FormatSettings } from '../../../shared/formatter/engine';
import { DEFAULT_FORMAT_SETTINGS } from '../../../shared/formatter/engine';

let settings: FormatSettings = { ...DEFAULT_FORMAT_SETTINGS };

/** Pull the persisted settings from the main process. Call on project open. */
export async function loadFormatSettings(): Promise<FormatSettings> {
  try {
    const loaded = await api.formatter.loadSettings();
    settings = {
      enabled: loaded.enabled ?? {},
      configs: loaded.configs ?? {},
    };
  } catch {
    settings = { ...DEFAULT_FORMAT_SETTINGS };
  }
  return settings;
}

/** Synchronous snapshot. Always returns the latest cached values. */
export function getFormatSettings(): FormatSettings {
  return settings;
}

/**
 * Merge `patch` into the cached settings and fire a main-side save. The
 * save is intentionally not awaited — the UI stays responsive and a
 * missed write on app-quit is low-stakes (nothing unrecoverable).
 */
export function setFormatSettings(patch: Partial<FormatSettings>): FormatSettings {
  settings = {
    enabled: { ...settings.enabled, ...(patch.enabled ?? {}) },
    configs: { ...settings.configs, ...(patch.configs ?? {}) },
  };
  api.formatter.saveSettings(settings).catch(() => { /* swallow \u2014 user will hit it again on next change */ });
  return settings;
}

/** Test-only: reset the in-memory cache to defaults. */
export function __resetFormatSettingsForTests(): void {
  settings = { ...DEFAULT_FORMAT_SETTINGS };
}
