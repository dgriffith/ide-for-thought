/**
 * CodeMirror extension: the in-editor half of the compute shell (#238).
 *
 *   - **Gutter marker** on every runnable fence's opening line — a
 *     small ▶ icon that runs the cell when clicked.
 *   - **Keymap**: `Cmd/Ctrl + Shift + Enter` runs the fence the cursor
 *     is currently inside.
 *   - **State indicator**: the gutter icon swaps to a muted "…" while a
 *     cell is running; error state is communicated through the written
 *     output block (`{type:"error",...}`), which the preview styles
 *     distinctly.
 *
 * Pure fence detection and output-block writing live in
 * `output-block.ts` — this module is the CodeMirror glue.
 */

import { EditorView, keymap, gutter, GutterMarker } from '@codemirror/view';
import { StateEffect, StateField, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  findRunnableFences,
  planOutputEdit,
  codeOf,
  type FenceRange,
} from './output-block';
import type { CellResult } from '../ipc/client';

// ── Running state ──────────────────────────────────────────────────────────

/** Effect marking a fence at `fenceStart` as running (`true`) or idle (`false`). */
const setRunning = StateEffect.define<{ fenceStart: number; running: boolean }>();

const runningField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(set, tr) {
    let next: Set<number> | null = null;
    for (const e of tr.effects) {
      if (e.is(setRunning)) {
        next = next ?? new Set(set);
        if (e.value.running) next.add(e.value.fenceStart);
        else next.delete(e.value.fenceStart);
      }
    }
    if (next) return next;
    // Map the set forward through doc changes so a fence's running state
    // survives later edits elsewhere in the doc.
    if (tr.docChanged) {
      const mapped = new Set<number>();
      for (const pos of set) {
        const m = tr.changes.mapPos(pos, 1);
        if (m != null && m >= 0) mapped.add(m);
      }
      return mapped;
    }
    return set;
  },
});

// ── Gutter markers ─────────────────────────────────────────────────────────

class RunMarker extends GutterMarker {
  constructor(readonly running: boolean) { super(); }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = this.running ? 'cm-compute-run cm-compute-running' : 'cm-compute-run';
    el.title = this.running ? 'Running…' : 'Run cell (Cmd+Shift+Enter)';
    el.textContent = this.running ? '…' : '▶';
    return el;
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof RunMarker && other.running === this.running;
  }
}

// ── Extension factory ──────────────────────────────────────────────────────

export interface ComputeCellsOptions {
  /**
   * Dispatch a cell to the backend and return the result. The extension
   * takes it from there — writes or replaces the output block beneath
   * the fence, toggles the running-state indicator.
   */
  runCell: (language: string, code: string) => Promise<CellResult>;
  /** Allow-list of fence languages that show the run affordance. */
  runnableLanguages?: Iterable<string>;
}

export function computeCellsExtension(opts: ComputeCellsOptions): Extension {
  const allowed = new Set<string>(
    [...(opts.runnableLanguages ?? ['sparql', 'sql', 'python'])].map((s) => s.toLowerCase()),
  );

  async function runFence(view: EditorView, fence: FenceRange): Promise<void> {
    const doc = view.state.doc.toString();
    const code = codeOf(doc, fence);
    view.dispatch({ effects: setRunning.of({ fenceStart: fence.startOffset, running: true }) });
    let result: CellResult;
    try {
      result = await opts.runCell(fence.language, code);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    // The doc may have shifted while we awaited; re-find the fence by
    // language + exact code text to stay glued to the right block if
    // anything above it got edited in the meantime.
    const nowDoc = view.state.doc.toString();
    const match = findRunnableFences(nowDoc, allowed).find(
      (f) => f.language === fence.language && codeOf(nowDoc, f) === code,
    );
    const target = match ?? fence;
    const edit = planOutputEdit(nowDoc, target, result);
    view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      effects: setRunning.of({ fenceStart: target.startOffset, running: false }),
    });
  }

  function fenceAtCursor(view: EditorView): FenceRange | null {
    const doc = view.state.doc.toString();
    const pos = view.state.selection.main.head;
    const fences = findRunnableFences(doc, allowed);
    for (const f of fences) {
      if (pos >= f.startOffset && pos < f.endOffset) return f;
    }
    return null;
  }

  const runGutter = gutter({
    class: 'cm-compute-gutter',
    lineMarker(view, line) {
      const running = view.state.field(runningField, false) ?? new Set<number>();
      const doc = view.state.doc.toString();
      const fences = findRunnableFences(doc, allowed);
      for (const f of fences) {
        if (f.startOffset === line.from) {
          return new RunMarker(running.has(f.startOffset));
        }
      }
      return null;
    },
    // No initialSpacer — we want the column to collapse to zero width
    // when the note has no runnable fences. Minor reflow when the first
    // fence is added beats a permanent dead strip on every note.
    domEventHandlers: {
      click: (view, line) => {
        const doc = view.state.doc.toString();
        const fences = findRunnableFences(doc, allowed);
        const fence = fences.find((f) => f.startOffset === line.from);
        if (!fence) return false;
        void runFence(view, fence);
        return true;
      },
    },
  });

  const runKeymap = Prec.high(keymap.of([
    {
      key: 'Mod-Shift-Enter',
      run: (view) => {
        const fence = fenceAtCursor(view);
        if (!fence) return false;
        void runFence(view, fence);
        return true;
      },
    },
  ]));

  return [runningField, runGutter, runKeymap];
}

// Small CSS block exposed so the host editor can include it alongside its
// own `.cm-*` styles. Kept here to co-locate with the gutter markers.
export const computeCellsStyles = `
  /* min-width 0 lets the column collapse entirely when the note has
     no runnable fences (paired with no initialSpacer on the gutter). */
  .cm-compute-gutter { min-width: 0; }
  .cm-compute-run {
    display: inline-block;
    width: 14px;
    text-align: center;
    color: var(--text-muted, #888);
    cursor: pointer;
    user-select: none;
    font-size: 10px;
    line-height: 1;
  }
  .cm-compute-run:hover { color: var(--accent, #4a9); }
  .cm-compute-running { color: var(--accent, #4a9); animation: cm-compute-pulse 1s infinite; }
  @keyframes cm-compute-pulse { 50% { opacity: 0.4; } }
`;
