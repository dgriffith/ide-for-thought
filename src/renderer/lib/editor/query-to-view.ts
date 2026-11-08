/**
 * "Convert to view" (#2947): rewrite the `:::query-list` / `:::query-table`
 * directive at a position as the `object-view` fence it already renders as
 * (`shared/views/directive-view.ts`). Optional for the user — the directive
 * stays valid and renders the same either way — and an ordinary edit, so ⌘Z
 * takes it back. Offered from the editor's right-click on a directive and from
 * the command palette.
 */
import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import { parseQueryDirectiveSource } from '../preview/query-directive';
import { directiveAsFence } from '../../../shared/views/directive-view';

/** The directive enclosing `pos` that converts — its document range and the fence — or null. */
export function directiveAt(doc: Text, pos: number): { from: number; to: number; fence: string } | null {
  const at = doc.lineAt(pos).number;
  for (let n = at; n >= 1; n--) {
    const open = doc.line(n);
    if (!/^\s*:::query-(list|table)\s*$/.test(open.text)) {
      if (n < at && /^\s*:::\s*$/.test(open.text)) return null; // the close of a block above
      continue;
    }
    for (let m = n + 1; m <= doc.lines; m++) {
      const close = doc.line(m);
      if (!/^\s*:::\s*$/.test(close.text)) continue;
      if (m < at) return null; // that block ended before `pos`
      const source = doc.sliceString(open.from, close.to);
      const parsed = parseQueryDirectiveSource(source);
      const fence = parsed ? directiveAsFence(parsed.type, parsed.query, parsed.config) : null;
      return fence ? { from: open.from, to: close.to, fence: fence.replace(/\n$/, '') } : null;
    }
    return null;
  }
  return null;
}

/** Replace the directive at the cursor with its view fence; false when there's none there. */
export function convertQueryDirectiveToView(view: EditorView | null, pos?: number): boolean {
  if (!view) return false;
  const found = directiveAt(view.state.doc, pos ?? view.state.selection.main.head);
  if (!found) return false;
  view.dispatch({ changes: { from: found.from, to: found.to, insert: found.fence }, userEvent: 'input.convert' });
  return true;
}
