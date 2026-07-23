import { dialog } from 'electron';
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import { getPythonTrust, setPythonTrust } from '../project-config';
import { runCell as runComputeCell, registeredLanguages as computeLanguages } from '../compute/registry';
import { restartKernel as restartPythonKernel, interruptKernel as interruptPythonKernel } from '../compute/python-kernel';
import {
  getPythonSettings,
  setPythonSettings,
  probePythonInterpreter,
  resolvePythonInterpreter,
  type PythonSettings,
} from '../compute/python-settings';
import { saveCellOutput, type SaveCellOutputInput } from '../compute/save-cell-output';
import { winFromEvent, withRootPath, withRootPathOr } from './helpers';

// propose_compute helpers (#245) now live in ../compute/proposal-helpers (#676,
// extracted so they're unit-testable without electron). Re-exported here for
// the existing import sites.
export {
  formatComputeResultAsContext,
  recordComputeProposalRun,
  buildComputeProposalNoteBlock,
} from '../compute/proposal-helpers';

export function registerCompute(): void {
  handle(Channels.COMPUTE_RUN_CELL, withRootPath(async (rootPath, language: string, code: string, notePath?: string) => {
    return await runComputeCell(language, code, { rootPath, ...(notePath !== undefined ? { notePath } : {}) });
  }));

  handle(Channels.COMPUTE_LANGUAGES, () => computeLanguages());

  handle(Channels.COMPUTE_RESTART_PYTHON_KERNEL, withRootPathOr(undefined, async (rootPath) => {
    await restartPythonKernel(rootPath);
  }));

  handle(Channels.COMPUTE_INTERRUPT_PYTHON, withRootPathOr<[], import('../compute/python-kernel').InterruptResult>({ ok: false, reason: 'no-kernel' }, (rootPath) =>
    interruptPythonKernel(rootPath)));

  handle(Channels.COMPUTE_GET_PYTHON_SETTINGS, async () => {
    return await getPythonSettings();
  });

  handle(Channels.COMPUTE_SET_PYTHON_SETTINGS, async (_e, settings: PythonSettings) => {
    await setPythonSettings({
      pythonPath: typeof settings?.pythonPath === 'string' ? settings.pythonPath : '',
    });
  });

  handle(Channels.COMPUTE_PROBE_PYTHON, async (_e, candidate?: string) => {
    // Empty `candidate` → probe the same interpreter the resolver
    // would pick right now (override → env var → python3). That's
    // the "active" interpreter the Settings status line surfaces.
    const target = candidate?.trim() ? candidate : await resolvePythonInterpreter();
    return await probePythonInterpreter(target);
  });

  handle(Channels.COMPUTE_GET_PYTHON_TRUST, withRootPathOr(false, (rootPath) =>
    getPythonTrust(rootPath)));

  handle(Channels.COMPUTE_SET_PYTHON_TRUST, withRootPath((rootPath, trusted: boolean) => {
    setPythonTrust(rootPath, trusted === true);
  }));

  handle(Channels.COMPUTE_BROWSE_PYTHON, async (e) => {
    const win = winFromEvent(e);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose Python interpreter',
      // No file-extension filter — a Python binary on macOS / Linux
      // typically has no extension, and a venv shim is just `python`
      // or `python3`. The probe step that follows verifies the pick
      // is actually runnable, so over-permissive picking is fine.
      properties: ['openFile', 'showHiddenFiles', 'noResolveAliases'],
      buttonLabel: 'Use this interpreter',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  handle(Channels.COMPUTE_SAVE_CELL_OUTPUT, withRootPath(async (rootPath, input: SaveCellOutputInput) => {
    return await saveCellOutput(rootPath, input);
  }));
}
