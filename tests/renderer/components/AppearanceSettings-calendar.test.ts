/**
 * @vitest-environment happy-dom
 *
 * Settings → Appearance's two Calendar settings (#2702): "Week starts on"
 * (Automatic, naming the day it resolves to, or Monday / Sunday / Saturday)
 * and "Show week numbers" (off by default), both written through the
 * calendar settings store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';

const getSystemLocale = vi.hoisted(() => vi.fn(async () => 'en-GB'));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { app: { getSystemLocale }, view: { getZoomFactor: () => 1, setZoomFactor: () => {} } },
}));

import AppearanceSettings from '../../../src/renderer/lib/components/AppearanceSettings.svelte';
import { getCalendarSettings, __resetCalendarSettingsForTests } from '../../../src/renderer/lib/stores/settings-calendar.svelte';

beforeEach(() => { localStorage.clear(); __resetCalendarSettingsForTests(); });
afterEach(() => cleanup());

function setup() {
  return render(AppearanceSettings, { onApplyFontSize: vi.fn(), onThemeChanged: vi.fn() });
}

describe('Calendar settings in Appearance', () => {
  it('Week starts on: Automatic by default, naming the system region\'s day', async () => {
    setup();
    const select = screen.getByLabelText<HTMLSelectElement>('Week starts on');
    expect(select.value).toBe('auto');
    await waitFor(() => expect(select.options[0]!.textContent).toBe('Automatic (Monday)')); // en-GB
    expect([...select.options].map((o) => o.value)).toEqual(['auto', 'monday', 'sunday', 'saturday']);
  });

  it('a pick is stored per machine and changes the week start', async () => {
    setup();
    const select = screen.getByLabelText<HTMLSelectElement>('Week starts on');
    await fireEvent.change(select, { target: { value: 'saturday' } });
    expect(getCalendarSettings().weekStart).toBe(6);
    expect(localStorage.getItem('minerva.calendar.weekStart')).toBe('saturday');
  });

  it('Show week numbers is off by default and toggles', async () => {
    setup();
    const box = screen.getByLabelText<HTMLInputElement>('Show week numbers');
    expect(box.checked).toBe(false);
    await fireEvent.click(box);
    expect(getCalendarSettings().showWeekNumbers).toBe(true);
    expect(localStorage.getItem('minerva.calendar.weekNumbers')).toBe('true');
  });
});
