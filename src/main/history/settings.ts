/**
 * Per-machine limits on local note history (#1158).
 *
 * Stored under `userData/history-settings.json` — machine-scoped, not
 * project-scoped, because what these govern is DISK: how long snapshots live,
 * how many pile up per note, and how big a file is still worth snapshotting.
 * The same thoughtbase on a roomier machine can reasonably keep more.
 *
 * Labeled revisions and a note's initial revision are exempt from the retention
 * rules regardless (see `policy.ts`) — a deliberate keepsake and the "undo
 * everything" baseline aren't what fills a disk.
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfigFile, asFiniteNumber, asRecord } from '../config/config-store';
import type { HistorySettings } from '../../shared/history';

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  retentionDays: 30,
  maxRevisionsPerNote: 500,
  // 1 MB. Notes are small text; this is high enough to never bother one and low
  // enough that a big generated .csv doesn't get snapshotted on every save.
  maxFileSizeKb: 1024,
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'history-settings.json');
}

/** Keep a setting usable: a zero/negative window or cap would mean "throw away
 *  every revision", which no user means by typing 0 in a retention box. Size is
 *  the exception — 0 there legitimately means "no limit". */
function sanitize(raw: HistorySettings): HistorySettings {
  return {
    retentionDays: Math.max(1, Math.round(raw.retentionDays)),
    maxRevisionsPerNote: Math.max(1, Math.round(raw.maxRevisionsPerNote)),
    maxFileSizeKb: Math.max(0, Math.round(raw.maxFileSizeKb)),
  };
}

export async function getHistorySettings(): Promise<HistorySettings> {
  return loadConfigFile(settingsPath, (raw) => {
    const o = asRecord(raw);
    return sanitize({
      retentionDays: asFiniteNumber(o.retentionDays, DEFAULT_HISTORY_SETTINGS.retentionDays),
      maxRevisionsPerNote: asFiniteNumber(o.maxRevisionsPerNote, DEFAULT_HISTORY_SETTINGS.maxRevisionsPerNote),
      maxFileSizeKb: asFiniteNumber(o.maxFileSizeKb, DEFAULT_HISTORY_SETTINGS.maxFileSizeKb),
    });
  }, DEFAULT_HISTORY_SETTINGS);
}

/** Persist the limits (sanitized) and hand back what was actually stored, so
 *  the settings panel shows the effective values rather than what was typed. */
export async function setHistorySettings(settings: HistorySettings): Promise<HistorySettings> {
  const next = sanitize(settings);
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}
