/**
 * Per-machine Python interpreter override for the compute kernel (#374).
 *
 * Stored under `userData/python-settings.json` so it's machine-scoped
 * (not project-scoped — different projects on the same machine all
 * share the same interpreter). The kernel resolver consults this
 * before the legacy `$MINERVA_PYTHON` env var so a user who's set
 * both gets the explicit Settings choice; the env var still works as
 * a CI / scripting escape hatch.
 *
 * We also probe an interpreter path on demand: spawn `python --version`
 * with a short timeout, return the version string + path. The
 * Settings UI uses this to validate user input before saving and to
 * display the resolved version in a status line.
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

export interface PythonSettings {
  /**
   * User-supplied path to a Python interpreter. Empty string when
   * no override is set; the resolver falls through to env-var /
   * PATH lookup in that case.
   */
  pythonPath: string;
}

export interface PythonProbeResult {
  ok: boolean;
  /** Resolved interpreter path (the input, normalised). */
  path: string;
  /** Version string from `python --version` (e.g. "Python 3.11.10"). */
  version?: string;
  /** Error message when `ok: false` — surfaced inline in the Settings UI. */
  error?: string;
}

const DEFAULT_SETTINGS: PythonSettings = { pythonPath: '' };

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'python-settings.json');
}

export async function getPythonSettings(): Promise<PythonSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PythonSettings>;
    return {
      pythonPath: typeof parsed.pythonPath === 'string' ? parsed.pythonPath : '',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setPythonSettings(settings: PythonSettings): Promise<void> {
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Resolved interpreter path for the kernel to spawn. Discovery order:
 * stored Settings override → `$MINERVA_PYTHON` → `python3` on PATH.
 *
 * Async because reading `userData` is filesystem I/O; the kernel
 * spawn path awaits this on every fresh kernel.
 */
export async function resolvePythonInterpreter(): Promise<string> {
  const stored = await getPythonSettings();
  if (stored.pythonPath.trim()) return stored.pythonPath.trim();
  if (process.env.MINERVA_PYTHON) return process.env.MINERVA_PYTHON;
  return 'python3';
}

/**
 * Probe a candidate interpreter — verify it exists and runs, capture
 * the version string. Used by the Settings UI before saving and to
 * surface the active interpreter's version in the status line.
 *
 * Hard 3-second timeout: a slow interpreter spawn (uninitialised
 * pyenv shim, network mount) shouldn't hang the Settings dialog.
 */
export async function probePythonInterpreter(candidate: string): Promise<PythonProbeResult> {
  const interpreter = (candidate || '').trim() || 'python3';
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: PythonProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(interpreter, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ ok: false, path: interpreter, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ ok: false, path: interpreter, error: 'Probe timed out after 3s' });
    }, 3000);

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
    proc.on('error', (err: Error) => {
      finish({ ok: false, path: interpreter, error: err.message });
    });
    proc.on('exit', (code: number | null) => {
      // Older Pythons (<3.4) wrote --version to stderr. Both bytes
      // checked so the probe works against any reasonable interpreter.
      const combined = (stdout + stderr).trim();
      const versionMatch = combined.match(/Python\s+(\d+(?:\.\d+){0,3})/);
      if (code === 0 && versionMatch) {
        finish({ ok: true, path: interpreter, version: combined });
        return;
      }
      finish({
        ok: false,
        path: interpreter,
        error: combined || `Process exited with code ${code ?? 'unknown'}`,
      });
    });
  });
}
