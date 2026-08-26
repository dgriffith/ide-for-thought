import type { EditorView } from '@codemirror/view';
import type { LinkRange } from './link-decorations';
import { findLinkAt } from './link-decorations';
import { extractClaimUri } from '../../../shared/refactor/find-arguments';
import { installDismissOnClickOutside } from '../dismiss-menu';
import { api } from '../ipc/client';
import { planBlockLink } from './block-link';
import type { EditorContextMenuState } from './context-menu-ops';
import type { EditorSettings } from './settings';

export interface ContextMenuOps {
  getView: () => EditorView | undefined;
  getFilePath: () => string;
  onOpenSource: ((sourceId: string) => void) | undefined;
  onOpenExcerpt: ((excerptId: string) => void) | undefined;
  onNavigate: ((target: string) => void) | undefined;
  onContextMenuOpen: (menu: EditorContextMenuState) => void;
  onContextMenuClose: () => void;
  onGutterMenuOpen: (menu: { x: number; y: number; lineNumbers: boolean }) => void;
  onGutterMenuClose: () => void;
  getEditorSettings: () => EditorSettings;
  applySettings: (settings: EditorSettings) => void;
  getSavedSelection: () => { anchor: number; head: number } | null;
  setSavedSelection: (sel: { anchor: number; head: number } | null) => void;
}

/**
 * Show the context menu at the right-click position. Resolves link/selection/claim info
 * from the editor state and updates the menu state.
 */
export function showContextMenu(ops: ContextMenuOps, e: MouseEvent): void {
  e.preventDefault();
  const view = ops.getView();
  let link: LinkRange | null = null;
  let hasSelection = false;
  let docPos: number | null = null;
  let claimUri: string | null = null;

  if (view) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    docPos = pos ?? null;
    if (pos != null) link = findLinkAt(view.state, pos);
    const sel = view.state.selection.main;
    hasSelection = sel.from !== sel.to;
    // Resolve a thought:Claim URI from (1) the active selection, then
    // (2) the line under the right-click. Powers Find Supporting /
    // Opposing Arguments — those need a Claim node to link Grounds to.
    const selText = hasSelection ? view.state.sliceDoc(sel.from, sel.to) : '';
    claimUri = extractClaimUri(selText);
    if (!claimUri && pos != null) {
      const line = view.state.doc.lineAt(pos);
      claimUri = extractClaimUri(line.text);
    }
  }

  const contextMenu: EditorContextMenuState = { x: e.clientX, y: e.clientY, link, hasSelection, docPos, claimUri };
  ops.onContextMenuOpen(contextMenu);
  installDismissOnClickOutside(() => ops.onContextMenuClose());
}

/**
 * Close the context menu and clear saved selection.
 */
export function closeContextMenu(ops: ContextMenuOps): void {
  ops.onContextMenuClose();
  ops.setSavedSelection(null);
}

/**
 * Handle right-click on the gutter area. Intercepts gutter-only clicks to show
 * a line-number visibility toggle.
 */
export function handleGutterContextMenu(ops: ContextMenuOps, e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('.cm-gutters')) return;
  e.preventDefault();
  e.stopPropagation();

  const current = ops.getEditorSettings();
  const gutterMenu = { x: e.clientX, y: e.clientY, lineNumbers: current.lineNumbers };
  ops.onGutterMenuOpen(gutterMenu);
  installDismissOnClickOutside(() => ops.onGutterMenuClose());
}

/**
 * Toggle line numbers in the editor settings and close the gutter menu.
 */
export function toggleLineNumbers(ops: ContextMenuOps): void {
  const current = ops.getEditorSettings();
  ops.applySettings({ ...current, lineNumbers: !current.lineNumbers });
  ops.onGutterMenuClose();
}

/**
 * Restore the selection we snapshotted on right-click and refocus the editor,
 * so menu-triggered commands operate on the original selection regardless of
 * what happened to focus/selection in between.
 */
export function restoreSelection(ops: ContextMenuOps): void {
  const view = ops.getView();
  if (!view) return;
  const savedSelection = ops.getSavedSelection();
  if (savedSelection) {
    view.dispatch({ selection: savedSelection });
  }
  view.focus();
}

/**
 * Open a link from the context menu (wiki-link, cite, quote, or external URL).
 */
export function openLink(ops: ContextMenuOps, link: LinkRange): void {
  if (link.kind === 'wiki') {
    if (link.linkType === 'cite') {
      ops.onOpenSource?.(link.href);
    } else if (link.linkType === 'quote') {
      ops.onOpenExcerpt?.(link.href);
    } else {
      ops.onNavigate?.(link.href);
    }
  } else {
    void api.shell.openExternal(link.href);
  }
  closeContextMenu(ops);
}

/**
 * Edit a link: move the selection to the link text and refocus the editor.
 */
export function editLink(ops: ContextMenuOps, link: LinkRange): void {
  const view = ops.getView();
  if (!view) return;
  view.dispatch({
    selection: { anchor: link.editFrom, head: link.editTo },
  });
  view.focus();
  closeContextMenu(ops);
}

/**
 * Run an inline menu action with selection restored and menu closed.
 * Use this for onclick handlers on template menu buttons.
 */
export function handleMenuAction(ops: ContextMenuOps, action: () => void): void {
  restoreSelection(ops);
  closeContextMenu(ops);
  action();
}

/**
 * Execute a native document command (e.g., copy, paste) with selection restored.
 */
export function execCommand(ops: ContextMenuOps, cmd: string): void {
  restoreSelection(ops);
  document.execCommand(cmd);
  closeContextMenu(ops);
}

/**
 * Run a CodeMirror command with selection restored and menu closed.
 */
export function runCommand(ops: ContextMenuOps, cmd: (v: EditorView) => boolean): void {
  restoreSelection(ops);
  const view = ops.getView();
  if (view) cmd(view);
  closeContextMenu(ops);
}

/**
 * Right-click action: anchor the paragraph under the cursor with a
 * `^block-id` marker (reusing any existing one) and copy the canonical
 * `[[note#^block-id]]` link to the clipboard. Blank lines and notes
 * with no path yet (unsaved buffers) are silently skipped.
 */
export async function copyBlockLink(ops: ContextMenuOps, contextMenu: EditorContextMenuState | null): Promise<void> {
  const view = ops.getView();
  const filePath = ops.getFilePath();

  if (!view || !contextMenu || contextMenu.docPos == null || !filePath) {
    closeContextMenu(ops);
    return;
  }

  const plan = planBlockLink(view.state.doc.toString(), contextMenu.docPos);
  if (!plan) {
    closeContextMenu(ops);
    return;
  }

  if (plan.edit) {
    view.dispatch({ changes: { from: plan.edit.at, insert: plan.edit.text } });
  }

  const relPath = filePath.replace(/\.md$/, '');
  await navigator.clipboard.writeText(`[[${relPath}#^${plan.blockId}]]`);
  closeContextMenu(ops);
}

/**
 * Adjust submenu position to keep it within viewport bounds.
 * Note: full implementation requires clampSubmenu, which is component-specific.
 */
export function adjustSubmenu(_event: MouseEvent): void {
  // Stub - component wrappers will provide the full implementation
}
