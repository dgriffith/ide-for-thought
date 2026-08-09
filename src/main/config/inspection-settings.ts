/**
 * Per-machine inspection preferences (#1792).
 *
 * Which health checks run, and the two thresholds that were hardcoded at 30
 * days inside `health-checks.ts` — "stale" and "long-unresolved" mean different
 * things to someone keeping a daily journal and someone maintaining a reference
 * library, and neither had a way to say so.
 *
 * Stored per machine, beside the other Settings-dialog config (ingest, python),
 * rather than in the thoughtbase: this is a preference about how much the app
 * nags you, not a property of the notes.
 *
 * `disabled` is a deny-list, not an allow-list, so a check added in a later
 * release is ON for existing users without a migration — the same reasoning as
 * the stock-skill catalog. Only checks the settings panel actually shows can be
 * disabled; a hidden one isn't silently switched off by a stale config.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfigFile, asRecord, asFiniteNumber, asStringArray } from './config-store';
import {
  visibleInspections,
  DEFAULT_INSPECTION_SETTINGS,
  type InspectionSettings,
} from '../../shared/inspections';

export { DEFAULT_INSPECTION_SETTINGS, type InspectionSettings };

/** Guard rails: a threshold of 0 (or 1e9) would make a check meaningless noise
 *  or dead weight, and a hand-edited config shouldn't be able to do that. */
const MIN_DAYS = 1;
const MAX_DAYS = 3650;

function clampDays(v: unknown, fallback: number): number {
  const n = Math.round(asFiniteNumber(v, fallback));
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'inspection-settings.json');
}

/** Keep only ids that name a real, user-visible check — a renamed check or a
 *  hand-edited file can't disable something the panel can't switch back on. */
function sanitizeDisabled(raw: unknown): string[] {
  const offerable = new Set(visibleInspections().map((i) => i.type));
  return asStringArray(raw, []).filter((t) => offerable.has(t));
}

export async function getInspectionSettings(): Promise<InspectionSettings> {
  return loadConfigFile(settingsPath, (raw) => {
    const o = asRecord(raw);
    return {
      disabled: sanitizeDisabled(o.disabled),
      staleDays: clampDays(o.staleDays, DEFAULT_INSPECTION_SETTINGS.staleDays),
      stubDays: clampDays(o.stubDays, DEFAULT_INSPECTION_SETTINGS.stubDays),
    };
  }, DEFAULT_INSPECTION_SETTINGS);
}

export async function saveInspectionSettings(settings: InspectionSettings): Promise<void> {
  const clean: InspectionSettings = {
    disabled: sanitizeDisabled(settings.disabled),
    staleDays: clampDays(settings.staleDays, DEFAULT_INSPECTION_SETTINGS.staleDays),
    stubDays: clampDays(settings.stubDays, DEFAULT_INSPECTION_SETTINGS.stubDays),
  };
  await fs.writeFile(settingsPath(), JSON.stringify(clean, null, 2), 'utf-8');
}
