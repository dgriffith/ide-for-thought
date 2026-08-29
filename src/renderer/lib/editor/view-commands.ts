/**
 * Editor.svelte's imperative view-command API (#1903) — the exported
 * functions the host calls via `bind:this` (find/replace, goto, selection
 * read/write, run-all-cells) that operate purely on the live `EditorView`
 * (plus, for `getClaimUriAtCursor`, the open context menu's resolved claim).
 * Same shape as `context-menu.ts`: an `Ops` closure struct so the pure
 * functions here never touch Svelte state directly, with Editor.svelte
 * keeping a one-line `export function` per command for `bind:this` access.
 */
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { sortLines } from './commands';
import { extractClaimUri } from '../../../shared/refactor/find-arguments';
import type { RunAllRef } from './compute-cells';
import type { EditorContextMenuState } from './context-menu-ops';

export interface ViewCommandOps {
  getView: () => EditorView | undefined;
  getRunAllRef: () => RunAllRef;
  getContextMenu: () => EditorContextMenuState | null;
}

export function runSortLines(ops: ViewCommandOps): void {
  const view = ops.getView();
  if (view) sortLines(view);
}

export function openFind(ops: ViewCommandOps): void {
  const view = ops.getView();
  if (!view) return;
  openSearchPanel(view);
}

export function openFindReplace(ops: ViewCommandOps): void {
  const view = ops.getView();
  if (!view) return;
  openSearchPanel(view);
  // The panel renders synchronously but focus lands on the search input —
  // hop to the replace field so Cmd+H lands where the user expects.
  requestAnimationFrame(() => {
    const replaceInput = view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]');
    replaceInput?.focus();
    replaceInput?.select();
  });
}

export function gotoLineColumn(ops: ViewCommandOps, line: number, col: number): void {
  const view = ops.getView();
  if (!view) return;
  const maxLine = view.state.doc.lines;
  const clampedLine = Math.max(1, Math.min(line, maxLine));
  const lineObj = view.state.doc.line(clampedLine);
  const maxCol = lineObj.length + 1;
  const clampedCol = Math.max(1, Math.min(col, maxCol));
  const pos = lineObj.from + clampedCol - 1;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  // Defer focus so the Enter keyup from the dialog doesn't fire in CM
  requestAnimationFrame(() => view.focus());
}

export function getCursorPosition(ops: ViewCommandOps): { line: number; column: number } {
  const view = ops.getView();
  if (!view) return { line: 1, column: 1 };
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  return { line: line.number, column: pos - line.from + 1 };
}

export function getOffset(ops: ViewCommandOps): number {
  const view = ops.getView();
  if (!view) return 0;
  return view.state.selection.main.head;
}

/**
 * Re-run every runnable code fence in the note, top to bottom
 * (the "Recompute all" toolbar action). Sequential, halts on the
 * first error — see `runAll` in compute-cells.ts.
 */
export async function runAllCells(ops: ViewCommandOps): Promise<void> {
  const view = ops.getView();
  const runAllRef = ops.getRunAllRef();
  if (!view || !runAllRef.run) return;
  await runAllRef.run(view);
}

export function getSelectionRange(ops: ViewCommandOps): { from: number; to: number } | null {
  const view = ops.getView();
  if (!view) return null;
  const main = view.state.selection.main;
  if (main.from === main.to) return null;
  return { from: main.from, to: main.to };
}

/** Selected text (empty string if no selection). Used by the
 *  snippet flow (#475) so a `{{selection}}` placeholder picks up
 *  whatever the user had highlighted at the trigger moment. */
export function getSelectedText(ops: ViewCommandOps): string {
  const view = ops.getView();
  if (!view) return '';
  const main = view.state.selection.main;
  if (main.from === main.to) return '';
  return view.state.doc.sliceString(main.from, main.to);
}

/**
 * Replace the current selection (or insert at the caret if there
 * is no selection) with `text`. If `caretWithin` is non-null, the
 * cursor lands at that offset inside the inserted text — used by
 * the snippet flow to honour a `{{cursor}}` marker. Returns true
 * if an edit was applied.
 */
export function insertText(ops: ViewCommandOps, text: string, caretWithin: number | null = null): boolean {
  const view = ops.getView();
  if (!view) return false;
  const main = view.state.selection.main;
  const insertPos = main.from;
  const finalCaret = caretWithin !== null
    ? insertPos + caretWithin
    : insertPos + text.length;
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: text },
    selection: { anchor: finalCaret },
  });
  view.focus();
  return true;
}

/**
 * Resolve a thought:Claim URI from the active selection, then the
 * line under the cursor. Returns null when nothing matches. Used by
 * Find Supporting / Opposing Arguments to identify their target.
 *
 * Prefers the right-click context (savedSelection / contextMenu) when
 * one is open, since the menu may have moved focus off the editor by
 * the time the App handler runs.
 */
export function getClaimUriAtCursor(ops: ViewCommandOps): string | null {
  const view = ops.getView();
  if (!view) return null;
  const contextMenu = ops.getContextMenu();
  if (contextMenu?.claimUri) return contextMenu.claimUri;
  const sel = view.state.selection.main;
  if (sel.from !== sel.to) {
    const hit = extractClaimUri(view.state.sliceDoc(sel.from, sel.to));
    if (hit) return hit;
  }
  const line = view.state.doc.lineAt(sel.head);
  return extractClaimUri(line.text);
}

export function gotoOffset(ops: ViewCommandOps, offset: number): void {
  const view = ops.getView();
  if (!view) return;
  const clamped = Math.max(0, Math.min(offset, view.state.doc.length));
  view.dispatch({
    selection: { anchor: clamped },
    effects: EditorView.scrollIntoView(clamped, { y: 'center' }),
  });
  view.focus();
}

export function restorePosition(ops: ViewCommandOps, offset: number, scrollTop?: number): void {
  const view = ops.getView();
  if (!view) return;
  const clamped = Math.max(0, Math.min(offset, view.state.doc.length));
  if (scrollTop && scrollTop > 0) {
    view.dispatch({ selection: { anchor: clamped } });
    view.scrollDOM.scrollTop = scrollTop;
  } else if (clamped > 0) {
    view.dispatch({
      selection: { anchor: clamped },
      effects: EditorView.scrollIntoView(clamped, { y: 'center' }),
    });
  }
  view.focus();
}
