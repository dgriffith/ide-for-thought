/**
 * @vitest-environment happy-dom
 *
 * Versioning settings panel (#1158) — the three limits on how much disk local
 * note history may cost. Self-contained: loads on mount, saves per change
 * through the settings store (which is real here; only the api boundary is
 * mocked). Pins the load, the per-change save, that a clamped value snaps back
 * to what was actually stored, and that a junk value doesn't persist.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { getSettingsMock, setSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  setSettingsMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { history: { getSettings: getSettingsMock, setSettings: setSettingsMock } },
}));

import VersioningSettings from '../../../src/renderer/lib/components/VersioningSettings.svelte';

const SAVED = { retentionDays: 30, maxRevisionsPerNote: 500, maxFileSizeKb: 1024 };

beforeEach(() => {
  getSettingsMock.mockResolvedValue({ ...SAVED });
  setSettingsMock.mockImplementation((s: unknown) => Promise.resolve(s));
});
afterEach(() => { cleanup(); getSettingsMock.mockReset(); setSettingsMock.mockReset(); });

const box = (label: string) => screen.getByLabelText(label);

describe('VersioningSettings (#1158)', () => {
  it('loads the stored limits on mount', async () => {
    render(VersioningSettings);
    await waitFor(() => expect(box('Keep versions for').value).toBe('30'));
    expect(box('Versions per note').value).toBe('500');
    expect(box('Maximum file size').value).toBe('1024');
  });

  it('saves each limit as it changes', async () => {
    render(VersioningSettings);
    await waitFor(() => expect(box('Keep versions for')).toBeTruthy());

    await fireEvent.change(box('Keep versions for'), { target: { value: '7' } });
    expect(setSettingsMock).toHaveBeenLastCalledWith({ ...SAVED, retentionDays: 7 });

    await fireEvent.change(box('Versions per note'), { target: { value: '20' } });
    expect(setSettingsMock).toHaveBeenLastCalledWith({ ...SAVED, retentionDays: 7, maxRevisionsPerNote: 20 });
  });

  it('shows what was actually stored when the main side clamps a value', async () => {
    setSettingsMock.mockResolvedValue({ ...SAVED, retentionDays: 1 });
    render(VersioningSettings);
    await waitFor(() => expect(box('Keep versions for')).toBeTruthy());

    // 0 days would mean "drop every unnamed version on the next save"; the
    // clamped value has to be visible, not silently different from the box.
    await fireEvent.change(box('Keep versions for'), { target: { value: '0' } });
    await waitFor(() => expect(box('Keep versions for').value).toBe('1'));
  });

  it('leaves the stored value alone when the box is emptied', async () => {
    render(VersioningSettings);
    await waitFor(() => expect(box('Maximum file size')).toBeTruthy());
    await fireEvent.change(box('Maximum file size'), { target: { value: '' } });
    expect(setSettingsMock).not.toHaveBeenCalled();
  });

  it('says plainly what a 0 size limit means', async () => {
    getSettingsMock.mockResolvedValue({ ...SAVED, maxFileSizeKb: 0 });
    render(VersioningSettings);
    await waitFor(() => expect(screen.getByText(/No limit/)).toBeTruthy());
  });

  it('surfaces a load failure instead of rendering empty boxes', async () => {
    getSettingsMock.mockRejectedValue(new Error('nope'));
    render(VersioningSettings);
    await waitFor(() => expect(screen.getByText(/Couldn't load versioning settings/)).toBeTruthy());
  });
});
