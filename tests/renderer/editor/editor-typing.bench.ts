/**
 * @vitest-environment happy-dom
 *
 * Renderer perf scenario: typing latency in a large note (#2385). Not run by
 * `pnpm test` — invoke with `pnpm bench`.
 *
 * Mounts a CodeMirror view with the editor's REAL extension list —
 * `buildExtensions`, exactly what `Editor.svelte` builds for a markdown note:
 * basicSetup, the markdown language with nested code languages, link /
 * broken-link / footnote / highlight decorations, the bookmark gutter, compute
 * cells — over a ~3,000-line, citation-heavy note, and times one keystroke:
 * insert a character, then delete it (so the document is the same size on
 * every iteration). Each is a full `view.dispatch` — the state update, the
 * incremental markdown reparse, every decoration plugin's `update`, and the
 * DOM update — which is the per-keystroke work a regression in any of those
 * layers would add to.
 *
 * happy-dom does no layout, so CodeMirror's measure phase sees zero sizes and
 * the numbers exclude real reflow; read them as a trend against the committed
 * baseline, not as the milliseconds a user feels.
 */
import { describe, test } from 'vitest';
import { assertFixtureReaches } from '../../helpers/bench-fixture';
import { buildLargeNote } from '../helpers/large-note';

const note = buildLargeNote(200, 2);

// `ipc/client.ts` reads `window.api` at module evaluation, and
// `build-extensions` imports it — so the stub goes in before the dynamic
// imports. Typing reaches none of these; they exist so the extensions build.
(window as unknown as { api: unknown }).api = {
  shell: { openExternal: async () => {} },
  notebase: { readFile: async () => '' },
};

const { EditorView } = await import('@codemirror/view');
const { EditorState, Compartment } = await import('@codemirror/state');
const { syntaxTree, ensureSyntaxTree } = await import('@codemirror/language');
const { buildExtensions } = await import('../../../src/renderer/lib/editor/build-extensions');

// Half the linked notes exist, so the broken-link layer has both kinds to mark.
const notePaths = Array.from({ length: 150 }, (_, i) => `note-${i * 2}.md`);

const parent = document.createElement('div');
document.body.appendChild(parent);
const view = new EditorView({
  parent,
  state: EditorState.create({
    doc: note.text,
    extensions: buildExtensions({
      plainTextOnce: false,
      getPlainText: () => false,
      filePath: 'research/large.md',
      initSettings: { tabSize: 2, wordWrap: true, lineNumbers: true, showWhitespace: false, alwaysCollapseFrontmatter: false, numberedHeadings: false },
      fontSize: 14,
      themeCompartment: new Compartment(),
      fontSizeCompartment: new Compartment(),
      tabSizeCompartment: new Compartment(),
      wrapCompartment: new Compartment(),
      lineNumbersCompartment: new Compartment(),
      whitespaceCompartment: new Compartment(),
      onNavigate: undefined,
      onOpenSource: undefined,
      onOpenExcerpt: undefined,
      getNotePaths: () => notePaths,
      getAliases: () => [],
      onRunCell: async () => ({ ok: true, output: { type: 'text', value: '' } }) as never,
      runAllRef: { run: null },
      onCreateNoteFromReference: undefined,
      getSavedSelection: () => null,
      setSavedSelection: () => {},
      showContextMenu: () => {},
      onImageDrop: () => {},
    }),
  }),
});

// Type inside a paragraph that carries a wiki-link, a tag and a cite link —
// the last such line the view rendered, so the decoration layers have
// something to redo around the edit. happy-dom has no layout, so CodeMirror
// renders only its default initial range (~900 characters here); a line past
// it would be edited with no decorations in play.
const renderedTo = view.visibleRanges[0]?.to ?? 0;
let line = view.state.doc.line(1);
for (let n = 1; n <= view.state.doc.lines; n++) {
  const l = view.state.doc.line(n);
  if (l.to > renderedTo) break;
  if (l.text.includes('[[cite::')) line = l;
}
const at = line.from + line.text.indexOf('builds on');

function keystroke(): void {
  view.dispatch({ changes: { from: at, insert: 'x' }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
  view.dispatch({ changes: { from: at, to: at + 1 }, selection: { anchor: at }, userEvent: 'delete.backward' });
}

// ── What this fixture must reach (#2383) ─────────────────────────────────────
// The note must be large, fully parsed as markdown, and the edit must land in
// a line the view actually rendered with the link layers active — otherwise
// the bench would time a dispatch against a document with nothing to decorate.
{
  ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
  keystroke();
  const dom = view.contentDOM;
  assertFixtureReaches('the note is large enough to matter', view.state.doc.lines > 3000, view.state.doc.lines);
  assertFixtureReaches('the markdown parser covers the whole note', syntaxTree(view.state).length === view.state.doc.length, { tree: syntaxTree(view.state).length, doc: view.state.doc.length });
  assertFixtureReaches('the edit lands on a paragraph with a link', line.text.includes('[[') && line.text.includes('[[cite::'), line.text);
  assertFixtureReaches('the edit line is rendered', view.visibleRanges.some((r) => r.from <= at && at <= r.to), view.visibleRanges);
  assertFixtureReaches('link decorations are live in the rendered range', dom.querySelectorAll('.cm-clickable-link').length > 0, dom.querySelectorAll('.cm-clickable-link').length);
  assertFixtureReaches('broken-link decorations are live in the rendered range', dom.querySelectorAll('.cm-broken-link').length > 0, dom.querySelectorAll('.cm-broken-link').length);
  assertFixtureReaches('a keystroke round-trip leaves the note unchanged', view.state.doc.toString() === note.text);
}

describe('editor typing', () => {
  const name = `editor keystroke (insert + delete) in a ${note.lines}-line note`;
  test(name, async ({ bench }) => {
    await bench(name, () => {
      keystroke();
    }).run();
  });
});
