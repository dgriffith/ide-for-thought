/**
 * Compute-shell types shared between main and renderer.
 *
 * Both sides duplicated these initially (main in compute/registry, renderer
 * in ipc/client); centralising here prevents drift and lets shared helpers
 * (derived-note builder, cell-id) import without reaching into either process.
 */

export type CellOutput =
  /**
   * Tabular result. Used by SQL / SPARQL fences and by the Python
   * kernel's pandas DataFrame renderer (#243). When the kernel hits
   * its row cap, `truncated: true` and `totalRows` carries the full
   * count so the renderer can show "Showing 1000 of N".
   */
  | {
      type: 'table';
      columns: string[];
      rows: Array<Array<string | number | boolean | null>>;
      /** Total rows in the source data; absent when no truncation happened. */
      totalRows?: number;
      /** True when the kernel capped the included rows. */
      truncated?: boolean;
    }
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  /**
   * Inline image — matplotlib `Figure`, `PIL.Image`, or `_repr_png_` /
   * `_repr_svg_` (#243). PNG payloads carry base64-encoded bytes; SVG
   * payloads carry the raw markup text.
   */
  | { type: 'image'; mime: 'image/png' | 'image/svg+xml'; data: string }
  /**
   * Rich-formatted HTML — typically from an object's `_repr_html_`
   * (Seaborn, IPython.display.HTML, etc.). The renderer sanitises via
   * DOMPurify before mounting so script injection from cell output
   * can't escape the output container.
   */
  | { type: 'html'; html: string };

export type CellResult =
  | { ok: true; output: CellOutput }
  | { ok: false; error: string };

/**
 * Per-machine Python execution settings (#374 interpreter, #1413 network,
 * #2218 cell timeout).
 *
 * Lives here for the same reason `PythonProbeResult` below does (#1878): the
 * IPC contract, the preload bridge, the renderer client and the settings panel
 * all need the shape, and each was restating it inline as
 * `{ pythonPath: string; allowNetwork: boolean }` — four copies free to drift,
 * which is exactly what adding a third field would have exposed.
 */
export interface PythonSettings {
  /**
   * User-supplied path to a Python interpreter. Empty string when no override
   * is set; the resolver falls through to `$MINERVA_PYTHON` then `python3`.
   */
  pythonPath: string;
  /**
   * Allow compute cells to make outbound network connections (#1413). Off by
   * default; read at kernel-spawn time, so a change needs a kernel restart.
   */
  allowNetwork: boolean;
  /**
   * Wall-clock budget for a single Python cell, in seconds (#2218). `0`
   * disables the limit entirely.
   *
   * Read fresh on every cell run rather than baked in at spawn like
   * `allowNetwork`, because a user who has just watched a cell hang wants the
   * new number to apply to their next run — not after a kernel restart, which
   * would also wipe every notebook's variables.
   */
  cellTimeoutSeconds: number;
}

/**
 * Default cell budget (#2218). Two minutes is deliberately generous: the point
 * is to stop a *hung* kernel wedging the whole project, not to police slow
 * analysis. A legitimate pandas join or model fit that runs long is a normal
 * thing to do in a compute cell, and the first matplotlib import alone can cost
 * ~10s building its font cache — so the number has to sit well clear of "slow
 * but working" before it fires.
 */
export const DEFAULT_CELL_TIMEOUT_SECONDS = 120;

/**
 * One day. Past this the limit is indistinguishable from "off", and it keeps
 * the derived `setTimeout` delay far below the 2^31-1 ms ceiling above which
 * Node silently fires the timer IMMEDIATELY — i.e. a user typing a very large
 * number to mean "basically never" would otherwise get "instantly", the exact
 * opposite of what they asked for. `0` is the supported way to say off.
 */
export const MAX_CELL_TIMEOUT_SECONDS = 86_400;

/**
 * Coerce a stored / user-entered budget into the canonical range.
 *
 * `<= 0` (and any non-finite value) collapses to 0, meaning "no limit" — a
 * negative in the file is nonsense, and folding it into the documented "0
 * disables" reading is kinder than silently substituting the default, which
 * would re-arm a limit the user was plainly trying to remove. A positive
 * fraction rounds UP to 1s rather than down to 0, so `0.4` never flips the
 * meaning from "very short limit" to "no limit at all".
 *
 * Exported for direct unit coverage: this is the one place the sentinel and
 * the clamp are decided, and both are easy to get subtly wrong.
 */
export function normalizeCellTimeoutSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.ceil(value), MAX_CELL_TIMEOUT_SECONDS);
}

/**
 * Outcome of probing a candidate Python interpreter (#1878).
 *
 * A discriminated union, like `CellResult` above and `InterruptResult` in the
 * kernel — not `{ ok: boolean; version?; error? }`, which was the shape until
 * #1878. That shape let `{ ok: true, error: '…' }` type-check and narrowed
 * nothing on `if (result.ok)`, so every consumer re-checked `version` the
 * compiler could have guaranteed.
 *
 * `path` is on both arms because the answer is always ABOUT an interpreter:
 * the settings status line names the one it probed whether or not it ran.
 *
 * Lives here rather than in `main/compute/python-settings.ts` because the
 * contract, the client and the settings panel all need it, and each was
 * restating the shape inline — three copies free to drift.
 *
 * Like the other unions here, the CALL does not reject: a probe that couldn't
 * run is an expected answer the settings status line renders, not a failure
 * the caller has to catch.
 */
export type PythonProbeResult =
  /** Ran, and reported a version — `version` is the raw `python --version` line. */
  | { ok: true; path: string; version: string }
  /** Didn't run, or didn't look like Python. `error` is user-facing. */
  | { ok: false; path: string; error: string };

/**
 * Wire format the Python kernel emits for last-expression results
 * (#243). Modelled on Jupyter's display-data MIME bundle so any future
 * frontend that already understands the shape can plug in. The
 * main-process side translates this into the typed `CellOutput`
 * above before crossing IPC.
 */
export interface KernelMimeBundle {
  mime: string;
  data: unknown;
}

/**
 * One thoughtbase's compute-trust standing on this machine (#1413), surfaced in
 * Settings → Compute so the user can see and revoke what they've trusted.
 * `blanket` = "trust all compute in this thoughtbase"; `cellCount` = individual
 * cells consented eyes-on-code.
 */
export interface ComputeConsentSummary {
  rootPath: string;
  blanket: boolean;
  cellCount: number;
}
