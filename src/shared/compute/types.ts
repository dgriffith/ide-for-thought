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
