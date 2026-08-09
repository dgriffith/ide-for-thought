/**
 * @vitest-environment node
 *
 * Per-machine inspection settings (#1792).
 *
 * The load path is where a settings file does damage quietly: a hand-edited or
 * half-migrated config shouldn't be able to switch off a check the panel can't
 * switch back on, or set a threshold that makes a check either useless or
 * unreachable. Corruption must surface rather than reset the user's choices to
 * defaults in silence — that's what `loadConfigFile` is for, and these pin that
 * this config uses it properly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const h = vi.hoisted(() => {
  const root = `${process.env.TMPDIR ?? '/tmp'}/minerva-inspection-settings-test`;
  return { root, getPath: vi.fn(() => root) };
});

vi.mock('electron', () => ({ app: { getPath: (n: string) => h.getPath(n) } }));

import {
  getInspectionSettings,
  saveInspectionSettings,
  DEFAULT_INSPECTION_SETTINGS,
} from '../../../src/main/config/inspection-settings';

const file = () => path.join(h.root, 'inspection-settings.json');
const write = (v: unknown) => fs.writeFileSync(file(), typeof v === 'string' ? v : JSON.stringify(v));

beforeEach(() => {
  fs.rmSync(h.root, { recursive: true, force: true });
  fs.mkdirSync(h.root, { recursive: true });
});
afterEach(() => {
  fs.rmSync(h.root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('getInspectionSettings', () => {
  it('defaults to every check on at 30 days when nothing is saved', async () => {
    expect(await getInspectionSettings()).toEqual(DEFAULT_INSPECTION_SETTINGS);
  });

  it('reads back what was saved', async () => {
    await saveInspectionSettings({ disabled: ['stale_note'], staleDays: 90, stubDays: 14 });
    expect(await getInspectionSettings()).toEqual({ disabled: ['stale_note'], staleDays: 90, stubDays: 14 });
  });

  it('drops ids the settings panel could never switch back on', async () => {
    // A hidden (argument-map) check and a check that no longer exists. Keeping
    // either would leave a check off with no way to notice or undo it.
    write({ disabled: ['stale_note', 'unsupported_claim', 'checkYourVibes'], staleDays: 30, stubDays: 30 });
    expect((await getInspectionSettings()).disabled).toEqual(['stale_note']);
  });

  it('clamps thresholds a hand-edited file could otherwise make meaningless', async () => {
    write({ disabled: [], staleDays: 0, stubDays: 99999 });
    const s = await getInspectionSettings();
    expect(s.staleDays).toBe(1);      // 0 days would flag every note, always
    expect(s.stubDays).toBe(3650);    // a decade is already "never"
  });

  it('rounds a fractional day count rather than carrying it into date maths', async () => {
    write({ disabled: [], staleDays: 7.6, stubDays: 30 });
    expect((await getInspectionSettings()).staleDays).toBe(8);
  });

  it('falls back per-field when a value is the wrong type', async () => {
    write({ disabled: 'stale_note', staleDays: 'soon', stubDays: null });
    expect(await getInspectionSettings()).toEqual(DEFAULT_INSPECTION_SETTINGS);
  });

  it('reports corruption instead of silently resetting', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    write('{ this is not json');
    expect(await getInspectionSettings()).toEqual(DEFAULT_INSPECTION_SETTINGS);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('[config]'));
  });
});

describe('saveInspectionSettings', () => {
  it('sanitizes on the way out too, so the file can never hold a value we reject', async () => {
    await saveInspectionSettings({ disabled: ['unsupported_claim', 'stale_note'], staleDays: 0, stubDays: 5 });
    const onDisk = JSON.parse(fs.readFileSync(file(), 'utf-8')) as { disabled: string[]; staleDays: number };
    expect(onDisk.disabled).toEqual(['stale_note']);
    expect(onDisk.staleDays).toBe(1);
  });
});
