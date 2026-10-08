/**
 * @vitest-environment happy-dom
 *
 * The Calendar's two per-machine settings (#2702): "Week starts on"
 * (Automatic from the system locale's region, or Monday / Sunday / Saturday)
 * and "Show week numbers" (off by default) — persisted, and Automatic asking
 * main for the region once.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getSystemLocale = vi.hoisted(() => vi.fn<() => Promise<string>>());
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { app: { getSystemLocale } } }));

import { getCalendarSettings, __resetCalendarSettingsForTests } from '../../../src/renderer/lib/stores/settings-calendar.svelte';
import { resolveWeekStart } from '../../../src/shared/objects/week-start';
import { silenceLogTags } from '../../helpers/quiet-logs';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  getSystemLocale.mockReset();
  getSystemLocale.mockResolvedValue('en-US');
  __resetCalendarSettingsForTests();
});

describe('Week starts on', () => {
  it('defaults to Automatic, which is the system locale region\'s first day', async () => {
    getSystemLocale.mockResolvedValue('en-DE'); // English, in Germany: Monday
    const s = getCalendarSettings();
    expect(s.weekStartSetting).toBe('auto');
    void s.weekStart; // the first read asks main
    await flush();
    expect(s.weekStart).toBe(1);
    getSystemLocale.mockResolvedValue('en-US');
    __resetCalendarSettingsForTests();
    void s.weekStart;
    await flush();
    expect(s.weekStart).toBe(7);
  });

  it('asks main once', async () => {
    const s = getCalendarSettings();
    void s.weekStart;
    void s.weekStart;
    void s.automaticWeekStart;
    await flush();
    void s.weekStart;
    expect(getSystemLocale).toHaveBeenCalledTimes(1);
  });

  it('Monday, Sunday and Saturday override it, and persist', () => {
    const s = getCalendarSettings();
    s.setWeekStart('sunday');
    expect(s.weekStart).toBe(7);
    s.setWeekStart('saturday');
    expect(s.weekStart).toBe(6);
    s.setWeekStart('monday');
    expect(s.weekStart).toBe(1);
    expect(localStorage.getItem('minerva.calendar.weekStart')).toBe('monday');
    __resetCalendarSettingsForTests();
    expect(getCalendarSettings().weekStartSetting).toBe('monday');
  });

  it('a fixed choice never asks main', () => {
    const s = getCalendarSettings();
    s.setWeekStart('saturday');
    void s.weekStart;
    expect(getSystemLocale).not.toHaveBeenCalled();
  });

  it('reads junk in storage as Automatic', () => {
    localStorage.setItem('minerva.calendar.weekStart', 'thursday');
    __resetCalendarSettingsForTests();
    expect(getCalendarSettings().weekStartSetting).toBe('auto');
  });

  describe('when main can\'t answer', () => {
    silenceLogTags('settings');
    it('falls back to the renderer language, then Monday', async () => {
      getSystemLocale.mockRejectedValue(new Error('no bridge'));
      const s = getCalendarSettings();
      void s.weekStart;
      await flush();
      expect(s.weekStart).toBe(resolveWeekStart('auto', [navigator.language]));
    });
  });
});

describe('Show week numbers', () => {
  it('is off by default, and persists when turned on', () => {
    const s = getCalendarSettings();
    expect(s.showWeekNumbers).toBe(false);
    s.setShowWeekNumbers(true);
    expect(s.showWeekNumbers).toBe(true);
    expect(localStorage.getItem('minerva.calendar.weekNumbers')).toBe('true');
    __resetCalendarSettingsForTests();
    expect(getCalendarSettings().showWeekNumbers).toBe(true);
    getCalendarSettings().setShowWeekNumbers(false);
    __resetCalendarSettingsForTests();
    expect(getCalendarSettings().showWeekNumbers).toBe(false);
  });
});
