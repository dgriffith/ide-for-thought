/**
 * @vitest-environment happy-dom
 *
 * Render coverage for ComputeSettings (#672) — the Python-interpreter panel
 * extracted from SettingsDialog. Self-contained: loads on mount and drives
 * api.compute.*. These tests mock that boundary and pin the probe-on-mount, the
 * probe status line, Browse, Save (with dirty-state gating), and Clear override.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const {
  getPythonSettingsMock, probePythonMock, browsePythonMock,
  setPythonSettingsMock, restartKernelMock, listConsentMock, revokeConsentMock, revealAuditLogMock,
} = vi.hoisted(() => ({
  getPythonSettingsMock: vi.fn(),
  probePythonMock: vi.fn(),
  browsePythonMock: vi.fn(),
  setPythonSettingsMock: vi.fn(),
  restartKernelMock: vi.fn(),
  listConsentMock: vi.fn(),
  revokeConsentMock: vi.fn(),
  revealAuditLogMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    compute: {
      getPythonSettings: getPythonSettingsMock,
      probePython: probePythonMock,
      browsePython: browsePythonMock,
      setPythonSettings: setPythonSettingsMock,
      restartPythonKernel: restartKernelMock,
      listConsent: listConsentMock,
      revokeConsent: revokeConsentMock,
      revealAuditLog: revealAuditLogMock,
    },
  },
}));

import ComputeSettings from '../../../src/renderer/lib/components/ComputeSettings.svelte';

beforeEach(() => {
  // Panels load these on mount; default to inert values so each test only sets
  // what it asserts on.
  listConsentMock.mockResolvedValue([]);
  setPythonSettingsMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  [getPythonSettingsMock, probePythonMock, browsePythonMock, setPythonSettingsMock,
    restartKernelMock, listConsentMock, revokeConsentMock, revealAuditLogMock].forEach((m) => m.mockReset());
});

describe('ComputeSettings (#672)', () => {
  it('loads the saved path on mount and probes, showing the version', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/usr/bin/python3', allowNetwork: false, cellTimeoutSeconds: 120 });
    probePythonMock.mockResolvedValue({ ok: true, path: '/usr/bin/python3', version: 'Python 3.12.1' });
    const { findByText, getByDisplayValue } = render(ComputeSettings, {});

    expect(await findByText('Python 3.12.1')).toBeTruthy();
    expect(getByDisplayValue('/usr/bin/python3')).toBeTruthy();
    // It probed the resolver's pick (input was non-empty → probes that path).
    expect(probePythonMock).toHaveBeenCalledWith('/usr/bin/python3');
  });

  it('shows the error state when the probe fails', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/bad/python', allowNetwork: false, cellTimeoutSeconds: 120 });
    probePythonMock.mockResolvedValue({ ok: false, path: '/bad/python', error: 'not executable' });
    const { findByText } = render(ComputeSettings, {});
    expect(await findByText(/Couldn't run interpreter/)).toBeTruthy();
    expect(await findByText('not executable')).toBeTruthy();
  });

  it('Browse sets the picked path and re-probes', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '', allowNetwork: false, cellTimeoutSeconds: 120 });
    probePythonMock.mockResolvedValue({ ok: true, path: 'x', version: 'Python 3.12' });
    browsePythonMock.mockResolvedValue('/opt/py/bin/python');
    const { findByText, getByText, getByDisplayValue } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    await fireEvent.click(getByText('Browse…'));
    await waitFor(() => expect(getByDisplayValue('/opt/py/bin/python')).toBeTruthy());
    expect(browsePythonMock).toHaveBeenCalledTimes(1);
  });

  it('Save is gated on dirty state and persists via api.compute.setPythonSettings', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/usr/bin/python3', allowNetwork: false, cellTimeoutSeconds: 120 });
    probePythonMock.mockResolvedValue({ ok: true, path: '/usr/bin/python3', version: 'Python 3.12' });
    setPythonSettingsMock.mockResolvedValue(undefined);
    const { findByText, getByText, getByDisplayValue } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    // Pristine → Save disabled.
    expect(getByText('Save').closest('button')!.disabled).toBe(true);

    await fireEvent.input(getByDisplayValue('/usr/bin/python3'), { target: { value: '/new/python' } });
    expect(getByText('Save').closest('button')!.disabled).toBe(false);

    await fireEvent.click(getByText('Save'));
    expect(setPythonSettingsMock).toHaveBeenCalledWith({
      pythonPath: '/new/python', allowNetwork: false, cellTimeoutSeconds: 120,
    });
  });

  it('Clear override blanks the path and saves', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/usr/bin/python3', allowNetwork: false, cellTimeoutSeconds: 120 });
    probePythonMock.mockResolvedValue({ ok: true, path: '/usr/bin/python3', version: 'Python 3.12' });
    setPythonSettingsMock.mockResolvedValue(undefined);
    const { findByText, getByText } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    await fireEvent.click(getByText('Clear override'));
    await waitFor(() => expect(setPythonSettingsMock).toHaveBeenCalledWith({
      pythonPath: '', allowNetwork: false, cellTimeoutSeconds: 120,
    }));
  });

  it('network toggle reflects the saved setting and persists on change (#1413)', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/usr/bin/python3', allowNetwork: false, cellTimeoutSeconds: 120 });
    probePythonMock.mockResolvedValue({ ok: true, path: '/usr/bin/python3', version: 'Python 3.12' });
    const { findByText, getByLabelText } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    const toggle = getByLabelText('Allow network access for Python cells');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await fireEvent.click(toggle);
    // Persists with the saved interpreter path + the new network choice.
    await waitFor(() =>
      expect(setPythonSettingsMock).toHaveBeenCalledWith({
        pythonPath: '/usr/bin/python3', allowNetwork: true, cellTimeoutSeconds: 120,
      }),
    );
  });

  it('network toggle loads as checked when network is allowed (#1413)', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '', allowNetwork: true, cellTimeoutSeconds: 120 });
    probePythonMock.mockResolvedValue({ ok: true, path: 'python3', version: 'Python 3.12' });
    const { findByText, getByLabelText } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    expect(getByLabelText('Allow network access for Python cells').getAttribute('aria-checked')).toBe('true');
  });

  it('the cell timeout loads from settings and persists on change (#2218)', async () => {
    getPythonSettingsMock.mockResolvedValue({
      pythonPath: '/usr/bin/python3', allowNetwork: false, cellTimeoutSeconds: 120,
    });
    probePythonMock.mockResolvedValue({ ok: true, path: '/usr/bin/python3', version: 'Python 3.12' });
    const { findByText, getByLabelText } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    const field = getByLabelText('Cell execution limit') as HTMLInputElement;
    expect(field.value).toBe('120');

    await fireEvent.input(field, { target: { value: '30' } });
    await fireEvent.change(field);
    // Sends the WHOLE record — the channel replaces the file, so a partial
    // write here would blank the interpreter override and the network choice.
    await waitFor(() => expect(setPythonSettingsMock).toHaveBeenCalledWith({
      pythonPath: '/usr/bin/python3', allowNetwork: false, cellTimeoutSeconds: 30,
    }));
  });

  it('a negative or empty limit is normalized to 0 IN THE FIELD, not just on disk (#2218)', async () => {
    // 0 means "no limit", and the user has to be able to see that that is what
    // they ended up with — a field still reading "-5" after a save that stored
    // 0 is a UI lying about the state of the machine.
    getPythonSettingsMock.mockResolvedValue({
      pythonPath: '', allowNetwork: false, cellTimeoutSeconds: 120,
    });
    probePythonMock.mockResolvedValue({ ok: true, path: 'python3', version: 'Python 3.12' });
    const { findByText, getByLabelText } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    const field = getByLabelText('Cell execution limit') as HTMLInputElement;
    await fireEvent.input(field, { target: { value: '-5' } });
    await fireEvent.change(field);

    await waitFor(() => expect(setPythonSettingsMock).toHaveBeenCalledWith({
      pythonPath: '', allowNetwork: false, cellTimeoutSeconds: 0,
    }));
    expect(field.value).toBe('0');
  });

  it('a failed save puts the limit field back to what is on disk (#2218)', async () => {
    getPythonSettingsMock.mockResolvedValue({
      pythonPath: '', allowNetwork: false, cellTimeoutSeconds: 120,
    });
    probePythonMock.mockResolvedValue({ ok: true, path: 'python3', version: 'Python 3.12' });
    setPythonSettingsMock.mockRejectedValue(new Error('disk full'));
    const { findByText, getByLabelText } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    const field = getByLabelText('Cell execution limit') as HTMLInputElement;
    await fireEvent.input(field, { target: { value: '15' } });
    await fireEvent.change(field);

    await waitFor(() => expect(field.value).toBe('120'));
  });

  it('Reveal audit log calls api.compute.revealAuditLog (#1413)', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '', allowNetwork: false, cellTimeoutSeconds: 120 });
    probePythonMock.mockResolvedValue({ ok: true, path: 'python3', version: 'Python 3.12' });
    revealAuditLogMock.mockResolvedValue(undefined);
    const { findByText, getByText } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    await fireEvent.click(getByText('Reveal audit log'));
    expect(revealAuditLogMock).toHaveBeenCalledTimes(1);
  });
});
