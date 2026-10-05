/**
 * Eyes-on-code compute consent (#373, #1325, #1411, #1412).
 *
 * Every executable compute fence runs with real capability (fs, network, any
 * installed package for Python; local file read/write for DuckDB SQL). Consent
 * is now **content-addressed and per-machine** (see `main/compute/consent.ts`):
 *
 *   - The first time a specific cell's code runs, MAIN shows the code and asks,
 *     in a native dialog (#2568).
 *     Approving records that cell's hash; editing it re-prompts.
 *   - A "Trust all compute in this thoughtbase" escape (the dialog checkbox)
 *     skips per-cell prompts for a project you own.
 *   - Consent lives per-machine, so it never travels with a shared thoughtbase.
 *
 * `ensureComputeConsent` is shared by the editor's ▶ gutter and the
 * conversation's propose_compute Run. The conversation path passes
 * `forceReview` so AI-authored code is always shown before its first run, even
 * under blanket trust. Main independently refuses an unconsented run
 * (`computeConsentGuard`), so this is the consent/UX half of a real boundary.
 */

import { api } from '../ipc/client';
import { RUNNABLE_LANGUAGE_SET } from '../../../shared/compute/fences';
import type { CellResult } from '../../../shared/compute/types';

/** The languages the compute shell can execute — every one runs with real
 *  capability, so each is gated. Reuses the executor registry's set so aliases
 *  (`py` / `python3`) can't slip past. */
const TRUST_GATED_LANGUAGES = RUNNABLE_LANGUAGE_SET;

export type ComputeConsentChoice = 'cell' | 'project' | 'cancel';

/**
 * Ensure the user has consented to running `code` before it executes. Returns
 * true when it may run (non-gated language, already consented, blanket-trusted,
 * or the user just approved) and false when they declined.
 *
 * Main asks (#2568): `requestConsent` shows main's own native dialog with the
 * code — the renderer can neither draw nor answer it — and records the choice.
 * `forceReview` (the conversation propose_compute path) shows the code even
 * under blanket trust — but not when this exact cell was already consented.
 */
export async function ensureComputeConsent(
  language: string,
  code: string,
  opts: { forceReview?: boolean } = {},
): Promise<boolean> {
  if (!TRUST_GATED_LANGUAGES.has(language.toLowerCase())) return true;
  const choice = await api.compute.requestConsent(language, code, opts.forceReview === true);
  return choice !== 'cancel';
}

export async function runCellWithTrust(
  language: string,
  code: string,
  notePath: string | undefined,
): Promise<CellResult> {
  if (!(await ensureComputeConsent(language, code))) {
    return {
      ok: false,
      error: 'Compute execution declined. Re-run the cell to review the code and approve it.',
    };
  }
  return api.compute.runCell(language, code, notePath);
}
