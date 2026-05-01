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
