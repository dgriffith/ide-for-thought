import { dialog } from 'electron';
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import { runCell as runComputeCell, registeredLanguages as computeLanguages } from '../compute/registry';
import { computeConsentGuard, consentStatus, grantConsent, listConsent, revokeConsent } from '../compute/consent';
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
    // Enforcement boundary (#1411/#1412): refuse to execute a cell the user
    // hasn't consented to, even if a caller reached the IPC without prompting.
    const guard = computeConsentGuard(rootPath, language, code);
    if (guard) return guard;
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
      allowNetwork: settings?.allowNetwork === true,
    });
  });

  handle(Channels.COMPUTE_PROBE_PYTHON, async (_e, candidate?: string) => {
    // Empty `candidate` → probe the same interpreter the resolver
    // would pick right now (override → env var → python3). That's
    // the "active" interpreter the Settings status line surfaces.
    const target = candidate?.trim() ? candidate : await resolvePythonInterpreter();
    return await probePythonInterpreter(target);
  });

  // Content-addressed compute consent (#1412). Status distinguishes an already
  // eyes-on-code'd cell (`cell`) from blanket project trust (`blanket`) so the
  // conversation path can force review even under blanket trust.
  handle(Channels.COMPUTE_CONSENT_STATUS, withRootPathOr('none', (rootPath, language: string, code: string) =>
    consentStatus(rootPath, language, code)));

  handle(Channels.COMPUTE_GRANT_CONSENT, withRootPath((rootPath, language: string, code: string, scope: 'cell' | 'project') => {
    grantConsent(rootPath, language, code, scope === 'project' ? 'project' : 'cell');
  }));

  // Trust management (#1413): list/revoke consent across every thoughtbase this
  // machine has trusted. These span projects (revoke targets an explicit path,
  // not the open one), so they're machine-scoped rather than withRootPath.
  handle(Channels.COMPUTE_LIST_CONSENT, () => listConsent());

  handle(Channels.COMPUTE_REVOKE_CONSENT, (_e, rootPath: string) => {
    revokeConsent(rootPath);
  });

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
