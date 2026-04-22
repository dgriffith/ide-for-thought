/**
 * Compute-shell types shared between main and renderer.
 *
 * Both sides duplicated these initially (main in compute/registry, renderer
 * in ipc/client); centralising here prevents drift and lets shared helpers
 * (derived-note builder, cell-id) import without reaching into either process.
 */

export type CellOutput =
  | { type: 'table'; columns: string[]; rows: Array<Array<string | number | boolean | null>> }
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown };

export type CellResult =
  | { ok: true; output: CellOutput }
  | { ok: false; error: string };
