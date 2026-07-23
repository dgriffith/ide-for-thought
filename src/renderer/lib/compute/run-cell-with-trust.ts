/**
 * Trust-gated wrapper around `api.compute.runCell` (#373, #1325).
 *
 * Every executable compute fence runs with real capability, not just
 * Python — so we prompt once per thoughtbase before the first
 * execution of ANY of them. Cancelling the prompt blocks the run;
 * clicking Run records the consent in `.minerva/config.json` so
 * subsequent cells in the same project skip the dialog.
 *
 * The languages that require consent (#1325):
 *   - `python` — runs with Minerva's full permissions (fs, network,
 *      every installed package).
 *   - `sql` — DuckDB is NOT a sandboxed dialect: `read_text`,
 *      `read_csv_auto`, `read_blob`, `glob(...)` read arbitrary local
 *      files and `COPY (…) TO '<path>'` writes them. (Network egress
 *      via the httpfs extension is additionally blocked at the DuckDB
 *      layer — see `sources/tables.ts` — but local file access is a
 *      core capability, so consent is still required.)
 *   - `sparql` — only queries the already-in-memory project graph and
 *      the rdfjs engine has no HTTP dereference actor (so `SERVICE`
 *      federation can't reach the network), but it's an executable
 *      fence and gated for consistency.
 *
 * The dialog flow lives in the renderer (we need a real Svelte
 * confirm dialog), but the trust state is project-scoped — stored
 * via the `compute:get/setPythonTrust` IPCs that read/write the
 * project config. The persisted flag is a single per-project
 * "run compute cells" consent (its stored name is historical).
 */

import { api } from '../ipc/client';
import { CONFIRM_KEYS } from '../confirm-keys';
import { RUNNABLE_LANGUAGE_SET } from '../../../shared/compute/fences';
import type { CellResult } from '../../../shared/compute/types';

/**
 * The trust gate covers exactly the languages the compute shell can
 * execute — every one of them runs with real capability (filesystem /
 * network / arbitrary packages), so consent is required before any of
 * them run (#1325). We reuse `RUNNABLE_LANGUAGE_SET` (the single source
 * of truth, kept in sync with the executor registry) rather than a local
 * list so the two can't drift and aliases like `py` / `python3` can't
 * slip through the gate.
 */
const TRUST_GATED_LANGUAGES = RUNNABLE_LANGUAGE_SET;

const COMPUTE_TRUST_PROMPT = [
  'Run compute cells in this thoughtbase?',
  '',
  'Compute cells (Python, SQL, SPARQL) run with real capability — they can read and write files on this machine and, for Python, make network requests and import any installed package.',
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
 * Run a cell, gating every executable language (python / sql / sparql)
 * through the per-project trust prompt (#1325). Non-executable
 * languages pass through unchanged.
 */
/**
 * Ensure the project has granted compute trust before an executable cell runs
 * (#1325, #1411). Returns true when execution may proceed (non-gated language,
 * already trusted, or the user just approved the prompt) and false when the user
 * declined. Shared by every run entry point — the editor's ▶ gutter AND the
 * conversation's propose_compute Run — so AI-drafted cells hit the same gate.
 * Main independently refuses an untrusted run (see compute/trust.ts), so this is
 * the consent/UX half of a real boundary, not the boundary itself.
 */
export async function ensureComputeTrust(language: string, deps: TrustGateDeps): Promise<boolean> {
  if (!TRUST_GATED_LANGUAGES.has(language.toLowerCase())) return true;
  if (await api.compute.getPythonTrust()) return true;
  const confirmed = await deps.showConfirm(
    COMPUTE_TRUST_PROMPT,
    CONFIRM_KEYS.pythonTrust,
    'Run',
    { hideDontAskAgain: true },
  );
  if (!confirmed) return false;
  await api.compute.setPythonTrust(true);
  return true;
}

export async function runCellWithTrust(
  language: string,
  code: string,
  notePath: string | undefined,
  deps: TrustGateDeps,
): Promise<CellResult> {
  if (!(await ensureComputeTrust(language, deps))) {
    return {
      ok: false,
      error: 'Compute execution declined for this thoughtbase. Open Settings → Compute or re-run a cell to be prompted again.',
    };
  }
  return api.compute.runCell(language, code, notePath);
}
