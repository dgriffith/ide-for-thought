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
import { planOutputEdit } from './output-block';
import {
  findRunnableFences,
  codeOf,
  RUNNABLE_LANGUAGES,
  type FenceRange,
} from '../../../shared/compute/fences';
import { scanComputeSafety } from '../../../shared/compute/safety';
import type { CellResult } from '../ipc/client';

/**
 * Tooltip for a fence's run marker given its red-flag scan (#1413). Returns
 * `null` when the cell is clean (the marker keeps its plain "Run cell" title),
 * or a caution string listing the matched patterns otherwise. Exported for
 * unit testing — the CodeMirror marker itself is trivial glue over this.
 */
export function flagTitleFor(language: string, code: string): string | null {
  const flags = scanComputeSafety(language, code);
  if (flags.length === 0) return null;
  // Strip the messages' markdown backticks — a plain-text title, not markup.
  const patterns = flags.map((f) => f.message.replace(/`/g, '')).join(', ');
  return `⚠ Risky patterns: ${patterns}. Review before running (Cmd+Shift+Enter).`;
}

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
  constructor(readonly running: boolean, readonly flagTitle: string | null) { super(); }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    // Flagged (#1413): keep the ▶ run affordance but tint it and swap the
    // tooltip to the caution list — an attention-raiser, not a block.
    const flagged = this.flagTitle !== null && !this.running;
    el.className = 'cm-compute-run'
      + (this.running ? ' cm-compute-running' : '')
      + (flagged ? ' cm-compute-flagged' : '');
    el.title = this.running ? 'Running…' : (this.flagTitle ?? 'Run cell (Cmd+Shift+Enter)');
    el.textContent = this.running ? '…' : '▶';
    return el;
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof RunMarker
      && other.running === this.running
      && other.flagTitle === this.flagTitle;
  }
}

// ── Extension factory ──────────────────────────────────────────────────────

/**
 * Handle the host holds to trigger a Run-all from outside the editor
 * (e.g. a toolbar button). The extension populates `.run` once built; the
 * host calls it with the live `EditorView`. Null until wired / after the
 * view is torn down.
 */
export interface RunAllRef {
  run: ((view: EditorView) => Promise<void>) | null;
}

export interface ComputeCellsOptions {
  /**
   * Dispatch a cell to the backend and return the result. The extension
   * takes it from there — writes or replaces the output block beneath
   * the fence, toggles the running-state indicator.
   */
  runCell: (language: string, code: string) => Promise<CellResult>;
  /** Allow-list of fence languages that show the run affordance. */
  runnableLanguages?: Iterable<string>;
  /**
   * Optional handle populated with the batch runner so the host can
   * trigger "Recompute all" from a toolbar/menu.
   */
  runAllRef?: RunAllRef;
}

export function computeCellsExtension(opts: ComputeCellsOptions): Extension {
  const allowed = new Set<string>(
    [...(opts.runnableLanguages ?? RUNNABLE_LANGUAGES)].map((s) => s.toLowerCase()),
  );

  /**
   * Run a single fence and write its output block. Returns the result so
   * callers (e.g. Run-all) can decide whether to continue. The doc may
   * shift while we await, so we re-find the fence before writing.
   */
  async function runFence(view: EditorView, fence: FenceRange): Promise<CellResult> {
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
    return result;
  }

  /**
   * Re-run every runnable fence in the note, top to bottom. Cells can
   * depend on prior cells' state (a Python fence building on an earlier
   * one's namespace), so runs are strictly sequential and the batch
   * **halts on the first error** — a failed cell invalidates anything
   * downstream that leaned on it.
   *
   * We re-scan the doc each iteration and take the i-th fence rather than
   * caching ranges: writing an output block shifts every offset below it.
   * Output blocks use the `output` language, which isn't runnable, so the
   * fence *count* stays stable and index-based iteration is safe even when
   * two fences share identical code.
   */
  async function runAll(view: EditorView): Promise<void> {
    const count = findRunnableFences(view.state.doc.toString(), allowed).length;
    for (let i = 0; i < count; i++) {
      const fence = findRunnableFences(view.state.doc.toString(), allowed)[i];
      if (!fence) break; // doc was edited out from under us; stop cleanly
      const result = await runFence(view, fence);
      if (!result.ok) break; // halt the batch; the error is already written
    }
  }

  if (opts.runAllRef) opts.runAllRef.run = runAll;

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
          return new RunMarker(running.has(f.startOffset), flagTitleFor(f.language, codeOf(doc, f)));
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
  /* Red-flag scan (#1413): amber run marker on a cell with risky patterns. */
  .cm-compute-flagged { color: var(--warning, #d19a66); }
  .cm-compute-flagged:hover { color: var(--warning, #d19a66); filter: brightness(1.15); }
  .cm-compute-running { color: var(--accent, #4a9); animation: cm-compute-pulse 1s infinite; }
  @keyframes cm-compute-pulse { 50% { opacity: 0.4; } }
`;
