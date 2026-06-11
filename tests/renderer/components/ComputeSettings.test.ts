/**
 * @vitest-environment happy-dom
 *
 * Render coverage for ComputeSettings (#672) — the Python-interpreter panel
 * extracted from SettingsDialog. Self-contained: loads on mount and drives
 * api.compute.*. These tests mock that boundary and pin the probe-on-mount, the
 * probe status line, Browse, Save (with dirty-state gating), and Clear override.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const {
  getPythonSettingsMock, probePythonMock, browsePythonMock,
  setPythonSettingsMock, restartKernelMock,
} = vi.hoisted(() => ({
  getPythonSettingsMock: vi.fn(),
  probePythonMock: vi.fn(),
  browsePythonMock: vi.fn(),
  setPythonSettingsMock: vi.fn(),
  restartKernelMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    compute: {
      getPythonSettings: getPythonSettingsMock,
      probePython: probePythonMock,
      browsePython: browsePythonMock,
      setPythonSettings: setPythonSettingsMock,
      restartPythonKernel: restartKernelMock,
    },
  },
}));

import ComputeSettings from '../../../src/renderer/lib/components/ComputeSettings.svelte';

afterEach(() => {
  cleanup();
  [getPythonSettingsMock, probePythonMock, browsePythonMock, setPythonSettingsMock, restartKernelMock]
    .forEach((m) => m.mockReset());
});

describe('ComputeSettings (#672)', () => {
  it('loads the saved path on mount and probes, showing the version', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/usr/bin/python3' });
    probePythonMock.mockResolvedValue({ ok: true, path: '/usr/bin/python3', version: 'Python 3.12.1' });
    const { findByText, getByDisplayValue } = render(ComputeSettings, {});

    expect(await findByText('Python 3.12.1')).toBeTruthy();
    expect(getByDisplayValue('/usr/bin/python3')).toBeTruthy();
    // It probed the resolver's pick (input was non-empty → probes that path).
    expect(probePythonMock).toHaveBeenCalledWith('/usr/bin/python3');
  });

  it('shows the error state when the probe fails', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/bad/python' });
    probePythonMock.mockResolvedValue({ ok: false, path: '/bad/python', error: 'not executable' });
    const { findByText } = render(ComputeSettings, {});
    expect(await findByText(/Couldn't run interpreter/)).toBeTruthy();
    expect(await findByText('not executable')).toBeTruthy();
  });

  it('Browse sets the picked path and re-probes', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '' });
    probePythonMock.mockResolvedValue({ ok: true, path: 'x', version: 'Python 3.12' });
    browsePythonMock.mockResolvedValue('/opt/py/bin/python');
    const { findByText, getByText, getByDisplayValue } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    await fireEvent.click(getByText('Browse…'));
    await waitFor(() => expect(getByDisplayValue('/opt/py/bin/python')).toBeTruthy());
    expect(browsePythonMock).toHaveBeenCalledTimes(1);
  });

  it('Save is gated on dirty state and persists via api.compute.setPythonSettings', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/usr/bin/python3' });
    probePythonMock.mockResolvedValue({ ok: true, path: '/usr/bin/python3', version: 'Python 3.12' });
    setPythonSettingsMock.mockResolvedValue(undefined);
    const { findByText, getByText, getByDisplayValue } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    // Pristine → Save disabled.
    expect(getByText('Save').closest('button')!.disabled).toBe(true);

    await fireEvent.input(getByDisplayValue('/usr/bin/python3'), { target: { value: '/new/python' } });
    expect(getByText('Save').closest('button')!.disabled).toBe(false);

    await fireEvent.click(getByText('Save'));
    expect(setPythonSettingsMock).toHaveBeenCalledWith({ pythonPath: '/new/python' });
  });

  it('Clear override blanks the path and saves', async () => {
    getPythonSettingsMock.mockResolvedValue({ pythonPath: '/usr/bin/python3' });
    probePythonMock.mockResolvedValue({ ok: true, path: '/usr/bin/python3', version: 'Python 3.12' });
    setPythonSettingsMock.mockResolvedValue(undefined);
    const { findByText, getByText } = render(ComputeSettings, {});
    await findByText('Python 3.12');

    await fireEvent.click(getByText('Clear override'));
    await waitFor(() => expect(setPythonSettingsMock).toHaveBeenCalledWith({ pythonPath: '' }));
  });
});
