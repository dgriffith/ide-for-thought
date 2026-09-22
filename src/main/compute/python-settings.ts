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
 *
 * The same file now also carries the network posture (#1413) and the
 * per-cell execution budget (#2218) — everything about HOW this machine
 * runs Python, rather than only WHICH Python it runs.
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfigFile, asString, asFiniteNumber, asRecord } from '../config/config-store';
import { DEFAULT_CELL_TIMEOUT_SECONDS, normalizeCellTimeoutSeconds } from '../../shared/compute/types';
import type { PythonProbeResult, PythonSettings } from '../../shared/compute/types';

// The settings shape itself moved to `shared/compute/types` in #2218, for the
// same reason the probe result moved in #1878: the contract, the preload
// bridge, the client and the settings panel each restated it inline, and the
// timeout field would have made that four places to remember. The timeout's
// range rules went with it — the settings PANEL has to clamp the same way
// this decoder does, and a renderer cannot import from `src/main/`.
// Re-exported so existing importers of this module still resolve.
export type { PythonSettings } from '../../shared/compute/types';

// The probe's result shape moved to `shared/compute/types` in #1878, where the
// IPC contract and the settings panel can share one definition instead of
// restating it. Re-exported so existing importers of this module still resolve.
export type { PythonProbeResult } from '../../shared/compute/types';

const DEFAULT_SETTINGS: PythonSettings = {
  pythonPath: '',
  allowNetwork: false,
  cellTimeoutSeconds: DEFAULT_CELL_TIMEOUT_SECONDS,
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'python-settings.json');
}

export async function getPythonSettings(): Promise<PythonSettings> {
  return loadConfigFile(settingsPath, (raw) => {
    const o = asRecord(raw);
    return {
      pythonPath: asString(o.pythonPath, DEFAULT_SETTINGS.pythonPath),
      // Default off — only a literal `true` enables network, so a corrupt or
      // truthy-non-bool value fails closed (matches the consent gate's posture).
      allowNetwork: o.allowNetwork === true,
      // A key that isn't there at all — every settings file written before
      // #2218 — must mean the DEFAULT, not "disabled", so the missing-key
      // fallback is the default and only an explicitly stored value can
      // reach the normalizer's `<= 0 → off` branch.
      cellTimeoutSeconds: o.cellTimeoutSeconds === undefined
        ? DEFAULT_CELL_TIMEOUT_SECONDS
        : normalizeCellTimeoutSeconds(asFiniteNumber(o.cellTimeoutSeconds, DEFAULT_CELL_TIMEOUT_SECONDS)),
    };
  }, DEFAULT_SETTINGS);
}

export async function setPythonSettings(settings: PythonSettings): Promise<void> {
  await fs.writeFile(
    settingsPath(),
    JSON.stringify({
      pythonPath: settings.pythonPath,
      allowNetwork: settings.allowNetwork === true,
      cellTimeoutSeconds: normalizeCellTimeoutSeconds(settings.cellTimeoutSeconds),
    }, null, 2),
    'utf-8',
  );
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
