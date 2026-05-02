/**
 * Trust-gated wrapper around `api.compute.runCell` (#373).
 *
 * Python cells run with the same permissions as Minerva — file
 * system, network, every installed package — so we prompt once per
 * thoughtbase before the first execution. Cancelling the prompt
 * blocks the run; clicking Run records the consent in
 * `.minerva/config.json` so subsequent cells in the same project
 * skip the dialog.
 *
 * The dialog flow lives in the renderer (we need a real Svelte
 * confirm dialog), but the trust state is project-scoped — stored
 * via the `compute:get/setPythonTrust` IPCs that read/write the
 * project config. SQL / SPARQL fences pass straight through;
 * they don't execute arbitrary code.
 */

import { api } from '../ipc/client';
import { CONFIRM_KEYS } from '../confirm-keys';
import type { CellResult } from '../../../shared/compute/types';

const PYTHON_TRUST_PROMPT = [
  'Run Python cells in this thoughtbase?',
  '',
  'Python cells run with the same permissions as Minerva — they can read and write files, make network requests, and import any installed package.',
  '',
  'Only run cells in thoughtbases you trust.',
].join('\n');

export interface TrustGateDeps {
  /**
   * Open a confirm dialog and return true on Run, false on Cancel.
   * Uses the existing showConfirm pattern but with the
   * `hideDontAskAgain` option so the per-machine localStorage
   * suppression doesn't bleed project-scoped trust into a global
   * "trust everywhere" state (the issue calls that tier out of scope).
   */
  showConfirm: (
    message: string,
    key: string,
    confirmLabel?: string,
    options?: { hideDontAskAgain?: boolean },
  ) => Promise<boolean>;
}

/**
 * Run a cell, gating Python through the per-project trust prompt.
 * Non-Python cells (sparql / sql) pass through unchanged.
 */
export async function runCellWithTrust(
  language: string,
  code: string,
  notePath: string | undefined,
  deps: TrustGateDeps,
): Promise<CellResult> {
  if (language === 'python') {
    const trusted = await api.compute.getPythonTrust();
    if (!trusted) {
      const confirmed = await deps.showConfirm(
        PYTHON_TRUST_PROMPT,
        CONFIRM_KEYS.pythonTrust,
        'Run',
        { hideDontAskAgain: true },
      );
      if (!confirmed) {
        return {
          ok: false,
          error: 'Python execution declined for this thoughtbase. Open Settings → Compute or re-run a cell to be prompted again.',
        };
      }
      await api.compute.setPythonTrust(true);
    }
  }
  return api.compute.runCell(language, code, notePath);
}
