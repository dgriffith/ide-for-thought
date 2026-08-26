import type { EditorSettings } from './settings';
import type { RunAllRef } from './compute-cells';
import type { CellResult } from '../../../shared/compute/types';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { cmTheme, minervaEditorTheme, fontSizeTheme, hiddenLineNumbersTheme } from './editor-theme';
import { indentUnit, foldService } from '@codemirror/language';
import { highlightWhitespace } from '@codemirror/view';
import { search } from '@codemirror/search';
import { api } from '../ipc/client';
import { selectionTracker } from './commands';
import { linkDecorations } from './link-decorations';
import { highlightDecorations } from './highlight-decorations';
import { brokenLinkDecorations } from './broken-link-decorations';
import { computeCellsExtension } from './compute-cells';
import { bookmarkGutterExtension } from './bookmark-gutter';
import { footnotePreview } from './footnote-preview';
import { linkPreview } from './link-preview';
import { footnoteDecorations } from './footnote-decorations';
import { hasImageFiles, imageFilesFromTransfer, imageFilesFromClipboard } from './image-drop';
import { dataTransferHasItem, draggedItemFromDataTransfer, wikiLinkForItem, insertWikiLinkAtPos } from './drag-link';
import { formatPaste } from './paste-format';
import { getFormatSettings } from '../formatter/settings';
import { buildParseCache } from '../../../shared/formatter/parse-cache';
import { findFrontmatterFoldRange } from './frontmatter';

export interface BuildExtensionsOptions {
  plainTextOnce: boolean;
  getPlainText: () => boolean;
  filePath: string;
  initSettings: EditorSettings;
  fontSize: number;
  themeCompartment: Compartment;
  fontSizeCompartment: Compartment;
  tabSizeCompartment: Compartment;
  wrapCompartment: Compartment;
  lineNumbersCompartment: Compartment;
  whitespaceCompartment: Compartment;
  onNavigate: ((target: string) => void) | undefined;
  onOpenSource: ((sourceId: string) => void) | undefined;
  onOpenExcerpt: ((excerptId: string) => void) | undefined;
  getNotePaths: (() => string[]) | undefined;
  getAliases: (() => readonly { alias: string; relativePath: string }[]) | undefined;
  onRunCell: (language: string, code: string, filePath: string) => Promise<CellResult>;
  runAllRef: RunAllRef;
  onCreateNoteFromReference: ((target: string) => void) | undefined;
  getSavedSelection: () => { anchor: number; head: number } | null;
  setSavedSelection: (sel: { anchor: number; head: number } | null) => void;
  showContextMenu: (e: MouseEvent) => void;
  onImageDrop: (files: File[], insertPos: number) => void | Promise<void>;
}

export function buildExtensions(opts: BuildExtensionsOptions): Extension[] {
  const { plainTextOnce, getPlainText, filePath, initSettings, fontSize, themeCompartment, fontSizeCompartment, tabSizeCompartment, wrapCompartment, lineNumbersCompartment, whitespaceCompartment, onNavigate, onOpenSource, onOpenExcerpt, getNotePaths, getAliases, onRunCell, runAllRef, onCreateNoteFromReference, getSavedSelection, setSavedSelection, showContextMenu, onImageDrop } = opts;

  return [
    basicSetup,
    // Give the `role="textbox"` content DOM an accessible name (#1005 a11y) —
    // CodeMirror's editable div is otherwise unlabeled (axe aria-input-field-name).
    EditorView.contentAttributes.of({ 'aria-label': plainTextOnce ? 'Text editor' : 'Note editor' }),
    // Mark plain-text editors so the drag-to-add-link machinery skips them —
    // a [[wiki-link]] doesn't resolve in a non-markdown file (#1129 / #1130).
    EditorView.editorAttributes.of(plainTextOnce ? { 'data-plaintext': 'true' } : {}),
    // Markdown language + frontmatter fold are markdown-only (#1130). A
    // plain-text file gets a plain editable buffer with no md syntax layer.
    ...(plainTextOnce ? [] : [
      markdown({ codeLanguages: languages }),
      // Pin the frontmatter fold's gutter arrow to line 1 by claiming the
      // foldable range there ourselves. Without this, the markdown
      // language's syntactic fold detection picks line 2 for the YAML
      // body, so toggling the fold makes the arrow jump between lines —
      // and a click-to-collapse from the expanded state leaves line 1 of
      // the YAML visible.
      foldService.of((state, lineStart) => {
        if (lineStart !== 0) return null;
        return findFrontmatterFoldRange(state.doc);
      }),
    ]),
    themeCompartment.of(cmTheme()),
    minervaEditorTheme(),
    search({
      top: true,
      scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: 'center' }),
    }),
    selectionTracker,
    fontSizeCompartment.of(fontSizeTheme(fontSize)),
    tabSizeCompartment.of([
      EditorState.tabSize.of(initSettings.tabSize),
      indentUnit.of(' '.repeat(initSettings.tabSize)),
    ]),
    wrapCompartment.of(initSettings.wordWrap ? EditorView.lineWrapping : []),
    lineNumbersCompartment.of(initSettings.lineNumbers ? [] : hiddenLineNumbersTheme()),
    whitespaceCompartment.of(initSettings.showWhitespace ? highlightWhitespace() : []),
    // Markdown-only rendering layers (#1130): wiki-link/URL decorations,
    // bookmark gutter, runnable compute cells, footnote + highlight decorations.
    ...(plainTextOnce ? [] : [
      linkDecorations({
        onOpenNote: (target: string) => {
          if (onNavigate) onNavigate(target);
        },
        onOpenSource: (sourceId: string) => {
          if (onOpenSource) onOpenSource(sourceId);
        },
        onOpenExcerpt: (excerptId: string) => {
          if (onOpenExcerpt) onOpenExcerpt(excerptId);
        },
        onOpenExternal: (url: string) => {
          void api.shell.openExternal(url);
        },
      }),
      // Registered before the bookmark gutter so the broken-link gutter stripe
      // sits in the left gutter group (near the line numbers), not out by the
      // text (#1446). Gutter columns render in registration order.
      brokenLinkDecorations({
        getNotePaths: () => getNotePaths?.() ?? [],
        getAliases: () => getAliases?.() ?? [],
      }),
      bookmarkGutterExtension(),
      computeCellsExtension({
        // Always the injected runner — never `api.compute.runCell` directly
        // (#1837). Running a cell writes an audit record to the project and
        // leaves state in a shared kernel, so it's a mutation, and the caller
        // that owns the consent gate should be the one to make it.
        runCell: (language, code) => onRunCell(language, code, filePath),
        runAllRef,
      }),
      footnotePreview(),
      linkPreview({
        getNotePaths: () => getNotePaths?.() ?? [],
        getAliases: () => getAliases?.() ?? [],
        readNote: (p) => api.notebase.readFile(p),
        // Broken-link hover lightbulb (#1446). Wrapped in a closure (not a bare
        // prop reference) so it stays current in the once-built extension list.
        onCreateNoteFromReference: (target: string) => onCreateNoteFromReference?.(target),
      }),
      footnoteDecorations(),
      highlightDecorations(),
    ]),
    EditorView.domEventHandlers({
      // Snapshot the selection at the very start of a right-click, before
      // any built-in handling can collapse it. Then, when the click is
      // inside the selection, preventDefault so CM's own mousedown doesn't
      // move the caret and visually wipe the highlight.
      mousedown: (e, view) => {
        if (e.button !== 2) return false;
        const sel = view.state.selection.main;
        setSavedSelection(sel.from !== sel.to
          ? { anchor: sel.anchor, head: sel.head }
          : null);
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        if (sel.from !== sel.to && pos >= sel.from && pos <= sel.to) {
          e.preventDefault();
          return true;
        }
        return false;
      },
      contextmenu: (e, view) => {
        // Backup snapshot — covers the context-menu keyboard shortcut,
        // where no right-click mousedown fires.
        if (!getSavedSelection() && view) {
          const sel = view.state.selection.main;
          if (sel.from !== sel.to) {
            setSavedSelection({ anchor: sel.anchor, head: sel.head });
          }
        }
        showContextMenu(e);
        return true;
      },
      // Drag-and-drop image upload (#455). When the dataTransfer
      // carries one or more image files, intercept before CodeMirror's
      // default text-drop handler runs — copy each into
      // `.minerva/assets/inline/` and insert `![](relative-path)` at
      // the drop position. Non-image drops (text, urls, internal CM
      // moves) fall through to the default handler.
      //
      // Both handlers stopPropagation when they take the drop —
      // App.svelte's `.editor-pane` wrapper has its own ondrop that
      // routes to the project-import flow (PDFs, markdown imports).
      // Without stopPropagation an image drop fires both handlers and
      // the import path rejects the JPEG with "doesn't ingest *.jpeg".
      dragover: (e) => {
        if (getPlainText()) return false; // no image-upload / wiki-link drop in plain text
        // Drag-to-add-link from an HTML5 source (file tree, bookmarks) — accept
        // the drop so `drop` fires (#1129).
        if (e.dataTransfer && dataTransferHasItem(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          return true;
        }
        if (e.dataTransfer && hasImageFiles(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          return true;
        }
        return false;
      },
      drop: (e, v) => {
        if (getPlainText()) return false;
        // Internal item → insert a resolving wiki-link at the drop point (#1129).
        const item = e.dataTransfer && draggedItemFromDataTransfer(e.dataTransfer);
        if (item) {
          e.preventDefault();
          e.stopPropagation();
          const dropPos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
          insertWikiLinkAtPos(v, dropPos, wikiLinkForItem(item));
          return true;
        }
        if (!e.dataTransfer || !hasImageFiles(e.dataTransfer)) return false;
        e.preventDefault();
        e.stopPropagation();
        const dropPos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
        void onImageDrop(imageFilesFromTransfer(e.dataTransfer), dropPos);
        return true;
      },
      // Paste-image upload (#455). Catches the macOS Cmd+Shift+Ctrl+4
      // → Cmd+V workflow and any other clipboard image source. Non-
      // image clipboard contents (text / html) fall through.
      paste: (e, v) => {
        if (getPlainText()) return false; // native paste — no image upload, no markdown reformat
        const items = e.clipboardData?.items;
        if (items) {
          const files = imageFilesFromClipboard(items);
          if (files.length > 0) {
            e.preventDefault();
            void onImageDrop(files, v.state.selection.main.head);
            return true;
          }
        }
        // Format-on-paste (#160): tidy the pasted text with the user's
        // enabled paste-safe formatter rules + the always-on paste fixups.
        const text = e.clipboardData?.getData('text/plain') ?? '';
        if (!text) return false;
        const pos = v.state.selection.main.from;
        // Never reformat content pasted into a code fence / math / inline
        // code — let the native paste insert it verbatim.
        if (buildParseCache(v.state.doc.toString()).isProtected(pos)) return false;
        const line = v.state.doc.lineAt(pos);
        const lineBeforeCursor = line.text.slice(0, pos - line.from);
        const out = formatPaste(text, getFormatSettings(), {
          lineBeforeCursor,
          inBlockquote: /^\s*>/.test(line.text),
        });
        if (out === text) return false; // unchanged → native paste
        e.preventDefault();
        v.dispatch(v.state.replaceSelection(out));
        return true;
      },
    }),
  ];
}
