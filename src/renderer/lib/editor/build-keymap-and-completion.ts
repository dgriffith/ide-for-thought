import { EditorView, keymap } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';
import { autocompletion, acceptCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { acceptCompletionEatTail, completionKeymapNoEnter } from './accept-completion-eat-tail';
import { indentWithTab } from '@codemirror/commands';
import { linkCompletionSource } from './link-autocomplete';
import { typeCreateCompletionSource } from './type-create-autocomplete';
import { resolveKeyBindings } from './command-registry';
import { api } from '../ipc/client';
import type { TypeInfo } from '../../../shared/objects/type-def';

export interface CursorInfo {
  line: number;
  column: number;
  selectionLength: number;
  wordCount: number;
}

export interface BuildKeymapAndCompletionOptions {
  onSave: () => void;
  openQuickFix: (view: EditorView) => boolean;
  onContentChange: (text: string) => void;
  onCursorChange: ((info: CursorInfo) => void) | undefined;
  getNotePaths: (() => string[]) | undefined;
  getSources: (() => readonly import('../../../shared/types').SourceMetadata[]) | undefined;
  getAliases: (() => readonly { alias: string; relativePath: string }[]) | undefined;
  tagCompletion: (context: CompletionContext) => Promise<CompletionResult | null>;
  resolveInlineTypeCreate: ((type: TypeInfo) => Promise<string | null>) | undefined;
  plainText: boolean;
  getIgnoreNextUpdate: () => boolean;
  setIgnoreNextUpdate: (value: boolean) => void;
}

export function buildKeymapAndCompletion(opts: BuildKeymapAndCompletionOptions): Extension[] {
  const {
    onSave,
    openQuickFix,
    onContentChange,
    onCursorChange,
    getNotePaths,
    getSources,
    getAliases,
    tagCompletion,
    resolveInlineTypeCreate,
    plainText,
    getIgnoreNextUpdate,
    setIgnoreNextUpdate,
  } = opts;

  const resolved = resolveKeyBindings();
  const appKeymap = Prec.highest(keymap.of([
    { key: 'Mod-s', run: () => { onSave(); return true; } },
    { key: 'Alt-Enter', run: (view) => view ? openQuickFix(view) : false },
    // Tab accepts the active completion, else indents (Shift-Tab outdents).
    // acceptCompletion returns false with no popup open, and same-key bindings
    // run in array order, so the fall-through lands on indentWithTab. Both
    // no-op while tab-focus mode is on (editor.toggleTabFocusMode, Ctrl-m),
    // which is what still lets keyboard users move focus out of the editor.
    { key: 'Tab', run: acceptCompletion },
    indentWithTab,
    // Enter accepts the active completion and eats the half-typed word tail
    // (#206) — only word chars, so `[[No|te]]` → `[[Notebook]]` keeps its
    // brackets. Returns false with no popup open, so Enter stays a newline /
    // list-continuation. completionKeymapNoEnter restores arrow-nav and
    // Escape that defaultKeymap:false (below) removes.
    { key: 'Enter', run: acceptCompletionEatTail },
    ...completionKeymapNoEnter,
    ...resolved.map(({ key: k, command: run }) => ({ key: k, run })),
  ]));

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && !getIgnoreNextUpdate()) {
      onContentChange(update.state.doc.toString());
    }
    setIgnoreNextUpdate(false);

    if (update.selectionSet || update.docChanged) {
      const { state } = update;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      const sel = state.selection.main;
      const docText = state.doc.toString();
      onCursorChange?.({
        line: line.number,
        column: pos - line.from + 1,
        selectionLength: Math.abs(sel.to - sel.from),
        wordCount: docText.trim() ? docText.trim().split(/\s+/).length : 0,
      });
    }
  });

  const linkCompletion = linkCompletionSource({
    getNotePaths: () => getNotePaths?.() ?? [],
    getSources: () => getSources?.() ?? [],
    getAliases: () => getAliases?.() ?? [],
    readNote: (p) => api.notebase.readFile(p),
  });

  // Inline `/book` typed creation (#1065). The apply removes the `/partial`,
  // then the host prompt+create runs async and its target is linked at the
  // same spot — type, template, and link in one gesture.
  const typeCreateCompletion = typeCreateCompletionSource({
    loadTypes: () => api.types.list().then((c) => c.types),
    onPick: (type, view, from, to) => {
      view.dispatch({ changes: { from, to, insert: '' } });
      void resolveInlineTypeCreate?.(type).then((target) => {
        if (!target || !view.dom.isConnected) return;
        const link = `[[${target}]]`;
        const at = Math.min(from, view.state.doc.length);
        view.dispatch({ changes: { from: at, insert: link }, selection: { anchor: at + link.length } });
      });
    },
  });

  const completion = autocompletion({
    override: [tagCompletion, linkCompletion, typeCreateCompletion],
    activateOnTyping: true,
    closeOnBlur: true,
    // Our Enter binding (acceptCompletionEatTail) owns accept-on-Enter; the
    // built-in one would win the tie otherwise (#206).
    defaultKeymap: false,
  });

  // Wiki-link / tag autocomplete is markdown-only (#1130).
  return [appKeymap, updateListener, ...(plainText ? [] : [completion])];
}
