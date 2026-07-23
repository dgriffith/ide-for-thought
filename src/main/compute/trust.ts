/**
 * Compute-trust enforcement boundary (#1411).
 *
 * The per-project "run compute cells" consent used to be a renderer-only UX
 * prompt (`runCellWithTrust`) — main's executor ran unconditionally, so any code
 * path that reached the IPC (notably `propose_compute`'s Run) executed with no
 * gate at all. This moves the CHECK into main: every renderer-reachable
 * execution entry point calls this first, so the renderer prompt now *grants*
 * trust rather than *being* the gate. A caller that forgets to prompt is
 * refused, not silently run.
 *
 * This does not reduce capability (that's the sandbox, #1329) — it makes the
 * existing consent a real boundary and closes the AI-authored-cell bypass.
 */
import { getPythonTrust } from '../project-config';
import type { CellResult } from '../../shared/compute/types';

const UNTRUSTED_ERROR =
  'Compute is not trusted for this thoughtbase. Run a cell from the editor and approve the ' +
  'prompt (or enable it in Settings → Compute) before running code here.';

/**
 * Guard a compute execution: returns an error `CellResult` to short-circuit the
 * caller when the project has not granted compute trust, or `null` when it's
 * trusted and execution may proceed.
 */
export function computeTrustGuard(rootPath: string): CellResult | null {
  if (getPythonTrust(rootPath)) return null;
  return { ok: false, error: UNTRUSTED_ERROR };
}
