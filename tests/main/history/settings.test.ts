/**
 * Versioning limits (#1158): the pure policy helpers that turn the settings
 * into behavior, and the sanitizing on the way in/out of disk.
 *
 * The sanitizer matters more than it looks: a retention window or per-note cap
 * of 0 would mean "throw away every revision on the next save", which nobody
 * means by clearing a settings box.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exceedsSizeLimit, retentionOptions } from '../../../src/main/history/policy';
import type { HistorySettings } from '../../../src/shared/history';

const LIMITS: HistorySettings = { retentionDays: 30, maxRevisionsPerNote: 500, maxFileSizeKb: 1024 };

describe('exceedsSizeLimit', () => {
  it('skips a file over the limit and keeps one at or under it', () => {
    expect(exceedsSizeLimit(1024 * 1024, LIMITS)).toBe(false); // exactly 1024 KB
    expect(exceedsSizeLimit(1024 * 1024 + 1, LIMITS)).toBe(true);
  });

  it('treats 0 as "no limit" — the escape hatch for a big file worth keeping', () => {
    expect(exceedsSizeLimit(500 * 1024 * 1024, { ...LIMITS, maxFileSizeKb: 0 })).toBe(false);
  });
});

describe('retentionOptions', () => {
  it('maps the settings onto the retention knobs', () => {
    expect(retentionOptions({ retentionDays: 7, maxRevisionsPerNote: 20, maxFileSizeKb: 0 }))
      .toEqual({ retentionDays: 7, maxPerNote: 20 });
  });
});

describe('history settings storage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-hist-settings-'));
    vi.resetModules();
    vi.doMock('electron', () => ({ app: { getPath: () => dir } }));
  });
  afterEach(async () => {
    vi.doUnmock('electron');
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function load() {
    return import('../../../src/main/history/settings');
  }

  it('falls back to defaults when nothing has been saved', async () => {
    const { getHistorySettings, DEFAULT_HISTORY_SETTINGS } = await load();
    expect(await getHistorySettings()).toEqual(DEFAULT_HISTORY_SETTINGS);
  });

  it('round-trips saved limits', async () => {
    const { getHistorySettings, setHistorySettings } = await load();
    await setHistorySettings({ retentionDays: 7, maxRevisionsPerNote: 20, maxFileSizeKb: 0 });
    expect(await getHistorySettings()).toEqual({ retentionDays: 7, maxRevisionsPerNote: 20, maxFileSizeKb: 0 });
  });

  it('clamps a window or cap of zero to something usable, and reports what it stored', async () => {
    const { setHistorySettings } = await load();
    const saved = await setHistorySettings({ retentionDays: 0, maxRevisionsPerNote: -5, maxFileSizeKb: -1 });
    // 0 days / 0 revisions would drop every unnamed version on the next save.
    expect(saved).toEqual({ retentionDays: 1, maxRevisionsPerNote: 1, maxFileSizeKb: 0 });
  });

  it('rounds fractional input rather than storing 3.7 days', async () => {
    const { setHistorySettings } = await load();
    const saved = await setHistorySettings({ retentionDays: 3.7, maxRevisionsPerNote: 9.2, maxFileSizeKb: 100.5 });
    expect(saved).toEqual({ retentionDays: 4, maxRevisionsPerNote: 9, maxFileSizeKb: 101 });
  });

  it('falls back per-field when the stored file is partial or wrong-typed', async () => {
    await fs.writeFile(
      path.join(dir, 'history-settings.json'),
      JSON.stringify({ retentionDays: 'soon', maxRevisionsPerNote: 12 }),
      'utf-8',
    );
    const { getHistorySettings, DEFAULT_HISTORY_SETTINGS } = await load();
    expect(await getHistorySettings()).toEqual({
      ...DEFAULT_HISTORY_SETTINGS,
      maxRevisionsPerNote: 12,
    });
  });
});
