/**
 * A confirmation the renderer can't fake (#2568).
 *
 * Every in-app dialog is drawn by the renderer, so a compromised renderer can
 * answer its own prompts. The channels that end in code execution — consent to
 * run a cell, adding or re-pointing an MCP stdio server, choosing or probing a
 * Python interpreter — ask here instead: a native `dialog.showMessageBox`
 * issued by main, showing exactly what will run. Then "the renderer is
 * compromised" no longer means "arbitrary code runs as the user": it still
 * needs a human to click a dialog the renderer didn't draw.
 *
 * House UX (CLAUDE.md): one dialog, plain question styling (no danger
 * colour), no "Don't ask again" — a remembered yes to running code is exactly
 * what a compromised renderer would want. Where a choice is legitimately
 * sticky (trusting a whole thoughtbase's compute) it's the checkbox, and it's
 * the user's to tick.
 */
import { BrowserWindow, dialog } from 'electron';

export interface NativeConfirmRequest {
  message: string;
  detail: string;
  confirmLabel: string;
  /** Optional checkbox (e.g. "Trust all code in this thoughtbase"). */
  checkboxLabel?: string;
}

export interface NativeConfirmResult {
  confirmed: boolean;
  checked: boolean;
}

/** Longest detail shown; past it the text says how much more there is. */
const MAX_DETAIL_CHARS = 6000;

export function clampDetail(detail: string): string {
  if (detail.length <= MAX_DETAIL_CHARS) return detail;
  const shown = detail.slice(0, MAX_DETAIL_CHARS);
  const hiddenLines = detail.slice(MAX_DETAIL_CHARS).split('\n').length;
  return `${shown}\n\n… ${hiddenLines} more line(s) not shown — review them in the note before confirming.`;
}

/**
 * Ask with a native dialog, modal to `win` when there is one. Resolves when
 * the user answers; Cancel / Escape / closing it is a no.
 */
export async function confirmNative(win: BrowserWindow | null | undefined, req: NativeConfirmRequest): Promise<NativeConfirmResult> {
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    message: req.message,
    detail: clampDetail(req.detail),
    buttons: [req.confirmLabel, 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    ...(req.checkboxLabel ? { checkboxLabel: req.checkboxLabel, checkboxChecked: false } : {}),
  };
  const { response, checkboxChecked } = win && !win.isDestroyed()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return { confirmed: response === 0, checked: response === 0 && checkboxChecked };
}
