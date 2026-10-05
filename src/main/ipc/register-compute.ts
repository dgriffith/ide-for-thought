import { dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import { runCell as runComputeCell, registeredLanguages as computeLanguages } from '../compute/registry';
import { computeConsentGuard, consentStatus, grantConsent, listConsent, revokeConsent } from '../compute/consent';
import { recordExecution, auditLogPath } from '../compute/audit';
import { restartKernel as restartPythonKernel, interruptKernel as interruptPythonKernel } from '../compute/python-kernel';
import {
  getPythonSettings,
  setPythonSettings,
  probePythonInterpreter,
  resolvePythonInterpreter,
  type PythonSettings,
} from '../compute/python-settings';
import { DEFAULT_CELL_TIMEOUT_SECONDS, normalizeCellTimeoutSeconds } from '../../shared/compute/types';
import { saveCellOutput, type SaveCellOutputInput } from '../compute/save-cell-output';
import { winFromEvent, withRootPath, withRootPathOr, withRootPathWin } from './helpers';
import { confirmNative } from '../native-confirm';
import type { IpcMainInvokeEvent } from 'electron';
import { logger } from '../../shared/logger';

// propose_compute helpers (#245) now live in ../compute/proposal-helpers (#676,
// extracted so they're unit-testable without electron). Re-exported here for
// the existing import sites.
export {
  formatComputeResultAsContext,
  recordComputeProposalRun,
  buildComputeProposalNoteBlock,
} from '../compute/proposal-helpers';

/**
 * Interpreter paths the user vouched for this session (#2568): picked in the
 * native file picker, or confirmed in main's dialog — so a typed path is asked
 * about once, not at Test and again at Save.
 */
const approvedInterpreters = new Set<string>();

/** Test seam. */
export function _resetApprovedInterpretersForTests(): void {
  approvedInterpreters.clear();
}

async function interpreterApproved(e: IpcMainInvokeEvent, interpreter: string, action: 'save' | 'probe'): Promise<boolean> {
  if (!interpreter || approvedInterpreters.has(interpreter)) return true;
  const answer = await confirmNative(winFromEvent(e), action === 'save'
    ? { message: 'Use this program as the Python interpreter?', detail: `Every Python cell will run:\n\n${interpreter}`, confirmLabel: 'Use It' }
    : { message: 'Run this program to check it?', detail: `Minerva will run:\n\n${interpreter} --version`, confirmLabel: 'Run' });
  if (answer.confirmed) approvedInterpreters.add(interpreter);
  return answer.confirmed;
}

export function registerCompute(): void {
  handle(Channels.COMPUTE_RUN_CELL, withRootPath(async (rootPath, language: string, code: string, notePath?: string) => {
    // Enforcement boundary (#1411/#1412): refuse to execute a cell the user
    // hasn't consented to, even if a caller reached the IPC without prompting.
    const guard = computeConsentGuard(rootPath, language, code);
    if (guard) return guard;
    const result = await runComputeCell(language, code, { rootPath, ...(notePath !== undefined ? { notePath } : {}) });
    recordExecution({ project: rootPath, language, code, provenance: 'editor', result, ...(notePath !== undefined ? { notePath } : {}) });
    return result;
  }));

  handle(Channels.COMPUTE_LANGUAGES, () => computeLanguages());

  handle(Channels.COMPUTE_RESTART_PYTHON_KERNEL, withRootPath(async (rootPath) => {
    await restartPythonKernel(rootPath);
  }));

  handle(Channels.COMPUTE_INTERRUPT_PYTHON, withRootPathOr<[], import('../compute/python-kernel').InterruptResult>({ ok: false, reason: 'no-kernel' }, (rootPath) =>
    interruptPythonKernel(rootPath)));

  handle(Channels.COMPUTE_GET_PYTHON_SETTINGS, async () => {
    return await getPythonSettings();
  });

  handle(Channels.COMPUTE_SET_PYTHON_SETTINGS, async (e, settings: PythonSettings) => {
    const requested = typeof settings?.pythonPath === 'string' ? settings.pythonPath.trim() : '';
    const current = (await getPythonSettings()).pythonPath;
    // A new interpreter is the program every Python cell will run (#2568):
    // main confirms it unless the user picked it in the native file picker or
    // already confirmed it. Declined → the other fields save, the path doesn't.
    const pythonPath = requested === current || (await interpreterApproved(e, requested, 'save')) ? requested : current;
    await setPythonSettings({
      pythonPath,
      allowNetwork: settings?.allowNetwork === true,
      // Re-validated main-side rather than trusted from the renderer, like
      // the two fields above — the payload crossing IPC is `unknown` in
      // practice and this handler is the boundary (#2218).
      //
      // An ABSENT field falls back to the default, not to 0, matching the
      // decoder in `python-settings.ts`. The two disagree in the one
      // direction that matters: `normalizeCellTimeoutSeconds(undefined)` is
      // 0, i.e. NO LIMIT — so a truncated or older payload would silently
      // switch off the very protection this channel is writing, and nothing
      // would report it.
      cellTimeoutSeconds: settings?.cellTimeoutSeconds === undefined
        ? DEFAULT_CELL_TIMEOUT_SECONDS
        : normalizeCellTimeoutSeconds(settings.cellTimeoutSeconds),
    });
  });

  handle(Channels.COMPUTE_PROBE_PYTHON, async (e, candidate?: string) => {
    // Empty `candidate` → probe the same interpreter the resolver
    // would pick right now (override → env var → python3). That's
    // the "active" interpreter the Settings status line surfaces.
    const typed = candidate?.trim() ?? '';
    if (typed && typed !== (await getPythonSettings()).pythonPath && !(await interpreterApproved(e, typed, 'probe'))) {
      // Probing RUNS `<path> --version` (#2568); without a yes, nothing runs.
      return { ok: false as const, path: typed, error: 'Not checked — running it was cancelled.' };
    }
    const target = typed || await resolvePythonInterpreter();
    return await probePythonInterpreter(target);
  });

  // Content-addressed compute consent (#1412). Status distinguishes an already
  // eyes-on-code'd cell (`cell`) from blanket project trust (`blanket`) so the
  // conversation path can force review even under blanket trust.
  handle(Channels.COMPUTE_CONSENT_STATUS, withRootPathOr('none', (rootPath, language: string, code: string) =>
    consentStatus(rootPath, language, code)));

  // Consent to run code is asked by MAIN, in a native dialog that shows the
  // code (#2568). The renderer used to show its own dialog and then call
  // `compute:grantConsent` — which a compromised renderer could call with no
  // dialog at all, then run anything. Now it can only ask; a human answers.
  // `forceReview` (a model-proposed cell) shows the code even under blanket
  // trust, unless this exact cell was already consented.
  handle(Channels.COMPUTE_REQUEST_CONSENT, withRootPathWin(async (rootPath, win, language: string, code: string, forceReview?: boolean) => {
    const status = consentStatus(rootPath, language, code);
    if (status === 'cell') return 'cell' as const;
    if (status === 'blanket' && !forceReview) return 'project' as const;
    const lang = language.toLowerCase() === 'sql' ? 'SQL' : language.toLowerCase() === 'python' ? 'Python' : language;
    const answer = await confirmNative(win, {
      message: `Run this ${lang} code?`,
      detail: 'It runs on your machine with access to your files'
        + (lang === 'Python' ? ' (and the network, if allowed, and any installed package)' : '')
        + '. Only run code you trust.\n\n' + code,
      confirmLabel: 'Run',
      checkboxLabel: 'Trust all code in this thoughtbase',
    });
    if (!answer.confirmed) return 'cancel' as const;
    const scope = answer.checked ? 'project' : 'cell';
    grantConsent(rootPath, language, code, scope);
    return scope;
  }));

  // Trust management (#1413): list/revoke consent across every thoughtbase this
  // machine has trusted. These span projects (revoke targets an explicit path,
  // not the open one), so they're machine-scoped rather than withRootPath.
  handle(Channels.COMPUTE_LIST_CONSENT, () => listConsent());

  handle(Channels.COMPUTE_REVOKE_CONSENT, (_e, rootPath: string) => {
    revokeConsent(rootPath);
  });

  // Execution audit log (#1413): reveal the per-machine JSONL trail in the OS
  // file manager. Ensure it exists first so reveal never fails on a machine
  // that hasn't run a cell yet.
  handle(Channels.COMPUTE_REVEAL_AUDIT_LOG, () => {
    const p = auditLogPath();
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf-8');
    } catch (err) {
      logger('compute').warn('could not ensure audit log before reveal:', err);
    }
    shell.showItemInFolder(p);
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
    const picked = result.filePaths[0] ?? null;
    // Chosen by the user in a native picker main opened: no second confirm
    // when it's then probed or saved (#2568).
    if (picked) approvedInterpreters.add(picked);
    return picked;
  });

  handle(Channels.COMPUTE_SAVE_CELL_OUTPUT, withRootPath(async (rootPath, input: SaveCellOutputInput) => {
    return await saveCellOutput(rootPath, input);
  }));
}
