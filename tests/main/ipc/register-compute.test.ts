/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-compute.ts` (#1840).
 *
 * Compute is where a renderer (or an LLM-authored proposal) asks main to
 * execute arbitrary code, so the handlers here carry two contracts worth
 * pinning rather than one:
 *
 *   - the #1631 project guard — `COMPUTE_RUN_CELL` / `COMPUTE_GRANT_CONSENT` /
 *     `COMPUTE_SAVE_CELL_OUTPUT` THROW with no project open, while the
 *     `withRootPathOr` handlers answer a value that genuinely means what it
 *     says (`'none'` = not consented, `{ ok: false, reason: 'no-kernel' }` =
 *     there is no kernel) rather than a disguised error;
 *   - the #1411/#1412 enforcement boundary — `COMPUTE_RUN_CELL` refuses a cell
 *     the user never consented to *even when the caller skipped the prompt*,
 *     and refusing means no execution at all.
 *
 * The consent store is the REAL one (`compute/consent.ts`, pointed at a temp
 * `userData`), because "the guard fires" is only worth asserting against the
 * real content-addressed hashing — a mocked guard would pass while the actual
 * boundary rotted. The executor, kernel, audit log and settings store are
 * mocked; they're what the handlers delegate to, not what they promise.
 *
 * Also pinned: the three discriminated `{ ok, … }` unions CLAUDE.md rule 3
 * names (`CellResult`, `PythonProbeResult`, `InterruptResult`) RESOLVE on their
 * failure arm. A caller branching on `ok` must never also have to catch.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  return {
    // Where the REAL consent store lives. Filled in below — `vi.hoisted` runs
    // before the `node:fs` import exists, and `app.getPath` is only ever called
    // from inside a handler, so a mutable holder is enough.
    userData: { dir: '' },
    handlers: new Map<string, Handler>(),
    win: { id: 1 },
    // electron
    showOpenDialog: vi.fn(),
    showItemInFolder: vi.fn(),
    // compute/registry
    runCell: vi.fn(),
    registeredLanguages: vi.fn(),
    // compute/audit
    recordExecution: vi.fn(),
    auditLogPath: vi.fn(),
    // compute/python-kernel
    restartKernel: vi.fn(),
    interruptKernel: vi.fn(),
    // compute/python-settings
    getPythonSettings: vi.fn(),
    setPythonSettings: vi.fn(),
    probePythonInterpreter: vi.fn(),
    resolvePythonInterpreter: vi.fn(),
    // compute/save-cell-output
    saveCellOutput: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showOpenDialog: h.showOpenDialog },
  shell: { showItemInFolder: h.showItemInFolder },
  // The REAL consent store reads this to find `compute-consent.json`.
  app: { getPath: () => h.userData.dir },
}));

vi.mock('../../../src/main/ipc/helpers', () => ({
  winFromEvent: () => h.win,
  rootPathFromEvent: () => openProject,
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, ...args);
      },
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (openProject ? fn(openProject, ...args) : fallback),
}));

vi.mock('../../../src/main/compute/registry', () => ({
  runCell: h.runCell,
  registeredLanguages: h.registeredLanguages,
}));
vi.mock('../../../src/main/compute/audit', () => ({
  recordExecution: h.recordExecution,
  auditLogPath: h.auditLogPath,
}));
vi.mock('../../../src/main/compute/python-kernel', () => ({
  restartKernel: h.restartKernel,
  interruptKernel: h.interruptKernel,
}));
vi.mock('../../../src/main/compute/python-settings', () => ({
  getPythonSettings: h.getPythonSettings,
  setPythonSettings: h.setPythonSettings,
  probePythonInterpreter: h.probePythonInterpreter,
  resolvePythonInterpreter: h.resolvePythonInterpreter,
}));
vi.mock('../../../src/main/compute/save-cell-output', () => ({ saveCellOutput: h.saveCellOutput }));
// register-compute re-exports the propose_compute helpers, which reach the
// graph on import. Nothing here calls them; the stub just keeps the graph out.
vi.mock('../../../src/main/graph/index', () => ({}));

import { registerCompute } from '../../../src/main/ipc/register-compute';
import { cellHash } from '../../../src/main/compute/consent';
import { Channels } from '../../../src/shared/channels';

registerCompute();
h.userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-compute-'));

const call = (channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args);
/** `call` wrapped so a SYNCHRONOUS throw (the `withRootPath` guard fires before
 *  the async body runs) is assertable with the same `rejects` matcher. */
const callAsync = async (channel: string, ...args: unknown[]) => call(channel, ...args);

const consentFile = () => path.join(h.userData.dir, 'compute-consent.json');

beforeEach(() => {
  vi.clearAllMocks();
  openProject = ROOT;
  // A machine that has never trusted anything — the state every assertion
  // about the guard has to start from.
  fs.rmSync(consentFile(), { force: true });
  h.auditLogPath.mockReturnValue(path.join(h.userData.dir, 'audit', 'compute-audit.jsonl'));
});

afterAll(() => { fs.rmSync(h.userData.dir, { recursive: true, force: true }); });

const OK_RESULT = { ok: true, output: { type: 'text', value: '42' } };

describe('COMPUTE_RUN_CELL — the consent enforcement boundary (#1411/#1412)', () => {
  it('refuses code the user never consented to, and executes nothing', async () => {
    h.runCell.mockResolvedValue(OK_RESULT);

    const result = await call(Channels.COMPUTE_RUN_CELL, 'python', 'import os; os.system("rm -rf ~")');

    // The refusal is a normal CellResult, not a rejection — the renderer
    // renders it in the output block like any other failed cell.
    expect(result).toEqual({ ok: false, error: expect.stringContaining('has not been approved to run') });
    // The point of the boundary: reaching the IPC without prompting buys nothing.
    expect(h.runCell).not.toHaveBeenCalled();
  });

  it('runs the cell once that exact code is consented', async () => {
    h.runCell.mockResolvedValue(OK_RESULT);
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'cell');

    await expect(callAsync(Channels.COMPUTE_RUN_CELL, 'python', 'print(1)')).resolves.toEqual(OK_RESULT);
    expect(h.runCell).toHaveBeenCalledWith('python', 'print(1)', { rootPath: ROOT });
  });

  it('consent is content-addressed — editing a single character re-refuses', async () => {
    h.runCell.mockResolvedValue(OK_RESULT);
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'cell');

    // This is the whole reason consent is keyed on a code hash: an approved
    // cell must not become a licence to run whatever replaces it.
    const result = await call(Channels.COMPUTE_RUN_CELL, 'python', 'print(2)');

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(h.runCell).not.toHaveBeenCalled();
  });

  it('blanket project trust lets an unseen cell run', async () => {
    h.runCell.mockResolvedValue(OK_RESULT);
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'anything', 'project');

    await expect(callAsync(Channels.COMPUTE_RUN_CELL, 'python', 'never seen before')).resolves.toEqual(OK_RESULT);
  });

  it("blanket trust is per-thoughtbase — it doesn't spill to another project", async () => {
    h.runCell.mockResolvedValue(OK_RESULT);
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'x', 'project');

    openProject = '/other-vault';
    const result = await call(Channels.COMPUTE_RUN_CELL, 'python', 'x');

    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(h.runCell).not.toHaveBeenCalled();
  });

  it('throws with no project open, rather than running against an unknown root', async () => {
    openProject = null;
    await expect(callAsync(Channels.COMPUTE_RUN_CELL, 'python', 'print(1)')).rejects.toThrow(/No project open/);
    expect(h.runCell).not.toHaveBeenCalled();
  });

  it('audits the run, keyed to the consent decision that permitted it', async () => {
    h.runCell.mockResolvedValue(OK_RESULT);
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'cell');

    await call(Channels.COMPUTE_RUN_CELL, 'python', 'print(1)', 'notes/a.md');

    expect(h.runCell).toHaveBeenCalledWith('python', 'print(1)', { rootPath: ROOT, notePath: 'notes/a.md' });
    expect(h.recordExecution).toHaveBeenCalledWith({
      project: ROOT,
      language: 'python',
      code: 'print(1)',
      // `editor` distinguishes a human-reviewed run from the LLM
      // propose_compute path, which is the higher-risk one the trail cares about.
      provenance: 'editor',
      notePath: 'notes/a.md',
      result: OK_RESULT,
    });
  });

  it('omits notePath entirely when the cell has no note (not `notePath: undefined`)', async () => {
    h.runCell.mockResolvedValue(OK_RESULT);
    call(Channels.COMPUTE_GRANT_CONSENT, 'sql', 'SELECT 1', 'cell');

    await call(Channels.COMPUTE_RUN_CELL, 'sql', 'SELECT 1');

    expect(h.runCell.mock.calls[0]?.[2]).not.toHaveProperty('notePath');
    expect(h.recordExecution.mock.calls[0]?.[0]).not.toHaveProperty('notePath');
  });

  it("a failed cell RESOLVES its `{ ok: false }` arm and is still audited", async () => {
    const failure = { ok: false, error: 'NameError: x is not defined' };
    h.runCell.mockResolvedValue(failure);
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'x', 'cell');

    // A cell that errors is a normal input, not a bug — CLAUDE.md rule 3.
    await expect(callAsync(Channels.COMPUTE_RUN_CELL, 'python', 'x')).resolves.toEqual(failure);
    // A failure is the *most* interesting thing to have on the trail.
    expect(h.recordExecution).toHaveBeenCalledWith(expect.objectContaining({ result: failure }));
  });

  it('propagates an executor crash (a thrown error is not a cell result)', async () => {
    h.runCell.mockRejectedValue(new Error('kernel died'));
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'boom', 'cell');

    await expect(callAsync(Channels.COMPUTE_RUN_CELL, 'python', 'boom')).rejects.toThrow(/kernel died/);
    expect(h.recordExecution).not.toHaveBeenCalled();
  });
});

describe('COMPUTE_CONSENT_STATUS / GRANT / LIST / REVOKE', () => {
  it('reports none → cell → blanket as consent is granted', () => {
    expect(call(Channels.COMPUTE_CONSENT_STATUS, 'python', 'print(1)')).toBe('none');

    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'cell');
    expect(call(Channels.COMPUTE_CONSENT_STATUS, 'python', 'print(1)')).toBe('cell');

    // An eyes-on-code'd cell keeps reporting `cell` under blanket trust, so the
    // conversation path can still tell "reviewed" from "merely trusted".
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'other', 'project');
    expect(call(Channels.COMPUTE_CONSENT_STATUS, 'python', 'print(1)')).toBe('cell');
    expect(call(Channels.COMPUTE_CONSENT_STATUS, 'python', 'unseen')).toBe('blanket');
  });

  it("with no project open answers 'none' — the fallback that FORCES a prompt", () => {
    openProject = null;
    // `withRootPathOr('none', …)`: the fallback is the conservative end of the
    // scale, so a missing project can never be read as trust.
    expect(call(Channels.COMPUTE_CONSENT_STATUS, 'python', 'print(1)')).toBe('none');
  });

  it('anything other than the literal "project" scope grants only this cell', () => {
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'everything');
    expect(call(Channels.COMPUTE_CONSENT_STATUS, 'python', 'print(1)')).toBe('cell');
    // No blanket trust leaked in from the unrecognised scope.
    expect(call(Channels.COMPUTE_CONSENT_STATUS, 'python', 'something else')).toBe('none');
  });

  it('GRANT throws with no project — trust cannot be recorded against nothing', () => {
    openProject = null;
    expect(() => call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'project')).toThrow(/No project open/);
    expect(fs.existsSync(consentFile())).toBe(false);
  });

  it('LIST and REVOKE are machine-scoped — they work with no project open', () => {
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'cell');
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'x', 'project');

    // Settings → Compute has to show (and undo) trust for thoughtbases that
    // aren't the open one, so these deliberately aren't `withRootPath`.
    openProject = null;
    expect(call(Channels.COMPUTE_LIST_CONSENT)).toEqual([
      { rootPath: ROOT, blanket: true, cellCount: 1 },
    ]);

    call(Channels.COMPUTE_REVOKE_CONSENT, ROOT);
    expect(call(Channels.COMPUTE_LIST_CONSENT)).toEqual([]);
  });

  it('a revoked thoughtbase prompts again on its next run', async () => {
    h.runCell.mockResolvedValue(OK_RESULT);
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'cell');
    call(Channels.COMPUTE_REVOKE_CONSENT, ROOT);

    const result = await call(Channels.COMPUTE_RUN_CELL, 'python', 'print(1)');
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(h.runCell).not.toHaveBeenCalled();
  });

  it('revoking a thoughtbase that was never trusted is a no-op, not an error', () => {
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'print(1)', 'project');
    call(Channels.COMPUTE_REVOKE_CONSENT, '/never-seen');
    // The unrelated root's consent record must survive untouched.
    expect(call(Channels.COMPUTE_LIST_CONSENT)).toEqual([
      { rootPath: ROOT, blanket: true, cellCount: 0 },
    ]);
  });

  it('hashes are stored, not the code itself', () => {
    call(Channels.COMPUTE_GRANT_CONSENT, 'python', 'API_KEY = "hunter2"', 'cell');
    const stored = fs.readFileSync(consentFile(), 'utf-8');
    // The consent store sits in userData forever; it must not become a copy of
    // every cell the user has ever run.
    expect(stored).not.toContain('hunter2');
    expect(stored).toContain(cellHash('python', 'API_KEY = "hunter2"'));
  });
});

describe('python kernel handlers', () => {
  it('COMPUTE_RESTART_PYTHON_KERNEL restarts the open project\'s kernel', async () => {
    await call(Channels.COMPUTE_RESTART_PYTHON_KERNEL);
    expect(h.restartKernel).toHaveBeenCalledWith(ROOT);
  });

  // #1894 — this used to be `withRootPathOr(undefined, …)`, indistinguishable
  // from its own success return (also `undefined`), so a restart request with
  // no project open silently resolved as if the kernel had restarted.
  it('COMPUTE_RESTART_PYTHON_KERNEL throws with no project rather than silently doing nothing', async () => {
    openProject = null;
    await expect(callAsync(Channels.COMPUTE_RESTART_PYTHON_KERNEL)).rejects.toThrow(/No project open/);
    expect(h.restartKernel).not.toHaveBeenCalled();
  });

  it('COMPUTE_INTERRUPT_PYTHON passes the kernel\'s result through, both arms', async () => {
    h.interruptKernel.mockReturnValue({ ok: true });
    await expect(callAsync(Channels.COMPUTE_INTERRUPT_PYTHON)).resolves.toEqual({ ok: true });

    // The failure arm RESOLVES; a renderer branching on `ok` never also catches.
    h.interruptKernel.mockReturnValue({ ok: false, reason: 'unsupported-platform' });
    await expect(callAsync(Channels.COMPUTE_INTERRUPT_PYTHON))
      .resolves.toEqual({ ok: false, reason: 'unsupported-platform' });
  });

  it('COMPUTE_INTERRUPT_PYTHON with no project answers the same "no-kernel" a real interrupt would', async () => {
    openProject = null;
    // `withRootPathOr({ ok: false, reason: 'no-kernel' }, …)` is legitimate
    // under #1631 rule 2: with no project there IS no kernel, so the fallback
    // means exactly what a genuine miss means — it isn't "error" in disguise.
    await expect(callAsync(Channels.COMPUTE_INTERRUPT_PYTHON))
      .resolves.toEqual({ ok: false, reason: 'no-kernel' });
    expect(h.interruptKernel).not.toHaveBeenCalled();
  });
});

describe('python settings handlers', () => {
  it('COMPUTE_GET_PYTHON_SETTINGS reads the per-machine settings', async () => {
    h.getPythonSettings.mockResolvedValue({ pythonPath: '/usr/bin/python3', allowNetwork: true });
    await expect(callAsync(Channels.COMPUTE_GET_PYTHON_SETTINGS))
      .resolves.toEqual({ pythonPath: '/usr/bin/python3', allowNetwork: true });
  });

  it('COMPUTE_SET_PYTHON_SETTINGS stores what it was given', async () => {
    await call(Channels.COMPUTE_SET_PYTHON_SETTINGS, { pythonPath: '/opt/py', allowNetwork: true });
    expect(h.setPythonSettings).toHaveBeenCalledWith({ pythonPath: '/opt/py', allowNetwork: true });
  });

  it('COMPUTE_SET_PYTHON_SETTINGS coerces a malformed payload to the safe defaults', async () => {
    // `allowNetwork` gates outbound network access from user code, so anything
    // that isn't literally `true` has to land on `false`.
    await call(Channels.COMPUTE_SET_PYTHON_SETTINGS, { pythonPath: 42, allowNetwork: 'yes' });
    expect(h.setPythonSettings).toHaveBeenCalledWith({ pythonPath: '', allowNetwork: false });
  });

  it('COMPUTE_SET_PYTHON_SETTINGS survives a missing payload', async () => {
    await call(Channels.COMPUTE_SET_PYTHON_SETTINGS, undefined);
    expect(h.setPythonSettings).toHaveBeenCalledWith({ pythonPath: '', allowNetwork: false });
  });

  it('COMPUTE_PROBE_PYTHON probes the candidate the caller named', async () => {
    h.probePythonInterpreter.mockResolvedValue({ ok: true, path: '/opt/py', version: 'Python 3.12.0' });
    await expect(callAsync(Channels.COMPUTE_PROBE_PYTHON, '/opt/py'))
      .resolves.toEqual({ ok: true, path: '/opt/py', version: 'Python 3.12.0' });
    expect(h.resolvePythonInterpreter).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])('COMPUTE_PROBE_PYTHON probes the ACTIVE interpreter for %j', async (candidate) => {
    // An empty box in Settings means "whatever we'd pick right now", which is
    // the resolver's answer — not a literal empty path.
    h.resolvePythonInterpreter.mockResolvedValue('/usr/bin/python3');
    h.probePythonInterpreter.mockResolvedValue({ ok: true, path: '/usr/bin/python3' });

    await call(Channels.COMPUTE_PROBE_PYTHON, candidate);
    expect(h.probePythonInterpreter).toHaveBeenCalledWith('/usr/bin/python3');
  });

  it('COMPUTE_PROBE_PYTHON RESOLVES a failed probe rather than rejecting', async () => {
    h.probePythonInterpreter.mockResolvedValue({ ok: false, path: '/nope', error: 'ENOENT' });
    // A bad interpreter path is a normal thing to type; Settings renders it inline.
    await expect(callAsync(Channels.COMPUTE_PROBE_PYTHON, '/nope'))
      .resolves.toEqual({ ok: false, path: '/nope', error: 'ENOENT' });
  });

  it('COMPUTE_BROWSE_PYTHON returns the picked interpreter', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/opt/homebrew/bin/python3'] });
    await expect(callAsync(Channels.COMPUTE_BROWSE_PYTHON)).resolves.toBe('/opt/homebrew/bin/python3');
    expect(h.showOpenDialog).toHaveBeenCalledWith(h.win, expect.objectContaining({ properties: expect.any(Array) }));
  });

  it.each([
    ['cancelled', { canceled: true, filePaths: [] }],
    ['dismissed with an empty selection', { canceled: false, filePaths: [] }],
  ])('COMPUTE_BROWSE_PYTHON returns null when the picker is %s', async (_label, dialogResult) => {
    // `null` here has exactly one meaning — the user didn't pick (#1631 rule 5).
    h.showOpenDialog.mockResolvedValue(dialogResult);
    await expect(callAsync(Channels.COMPUTE_BROWSE_PYTHON)).resolves.toBeNull();
  });
});

describe('COMPUTE_REVEAL_AUDIT_LOG', () => {
  it('creates the log before revealing it, so a machine that never ran a cell still works', () => {
    const logPath = path.join(h.userData.dir, 'fresh', 'compute-audit.jsonl');
    h.auditLogPath.mockReturnValue(logPath);

    call(Channels.COMPUTE_REVEAL_AUDIT_LOG);

    expect(fs.existsSync(logPath)).toBe(true);
    expect(h.showItemInFolder).toHaveBeenCalledWith(logPath);
  });

  it('leaves an existing log untouched', () => {
    const logPath = path.join(h.userData.dir, 'existing', 'compute-audit.jsonl');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, '{"at":"2026-01-01T00:00:00Z"}\n', 'utf-8');
    h.auditLogPath.mockReturnValue(logPath);

    call(Channels.COMPUTE_REVEAL_AUDIT_LOG);

    expect(fs.readFileSync(logPath, 'utf-8')).toBe('{"at":"2026-01-01T00:00:00Z"}\n');
  });

  it('still reveals when the log cannot be created', () => {
    // A blocked parent (here: a file where a directory should be) is a reveal
    // that shows nothing useful — but it must not reject the IPC.
    const blocker = path.join(h.userData.dir, 'blocked');
    fs.writeFileSync(blocker, 'not a directory', 'utf-8');
    h.auditLogPath.mockReturnValue(path.join(blocker, 'compute-audit.jsonl'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => call(Channels.COMPUTE_REVEAL_AUDIT_LOG)).not.toThrow();
    expect(h.showItemInFolder).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the remaining delegations', () => {
  it('COMPUTE_LANGUAGES lists the registered executors, project or not', () => {
    h.registeredLanguages.mockReturnValue(['python', 'sql', 'sparql']);
    expect(call(Channels.COMPUTE_LANGUAGES)).toEqual(['python', 'sql', 'sparql']);

    // Which languages CAN run is a property of the build, not of the project.
    openProject = null;
    expect(call(Channels.COMPUTE_LANGUAGES)).toEqual(['python', 'sql', 'sparql']);
  });

  it('COMPUTE_SAVE_CELL_OUTPUT writes through to the open project', async () => {
    h.saveCellOutput.mockResolvedValue({ kind: 'written', path: 'data/out.csv' });
    const input = { format: 'csv', notePath: 'notes/a.md', cellId: 'c1' };

    await expect(callAsync(Channels.COMPUTE_SAVE_CELL_OUTPUT, input))
      .resolves.toEqual({ kind: 'written', path: 'data/out.csv' });
    expect(h.saveCellOutput).toHaveBeenCalledWith(ROOT, input);
  });

  it('COMPUTE_SAVE_CELL_OUTPUT throws with no project rather than writing somewhere', async () => {
    openProject = null;
    await expect(callAsync(Channels.COMPUTE_SAVE_CELL_OUTPUT, {})).rejects.toThrow(/No project open/);
    expect(h.saveCellOutput).not.toHaveBeenCalled();
  });
});
