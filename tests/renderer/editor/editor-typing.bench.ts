/**
 * @vitest-environment jsdom
 *
 * Renderer perf scenario (#2385): what one keystroke costs the editor in a
 * large note. Not run by `pnpm test` — invoke with `pnpm bench`.
 *
 * Mounts a real CodeMirror `EditorView` over a ~1,900-line note with the app's
 * own extension set — `buildExtensions`, exactly what `Editor.svelte` builds
 * (basicSetup, the markdown language with nested code languages, and every
 * Minerva extension: link / broken-link / footnote / highlight decorations,
 * the bookmark and compute-cell gutters, link and footnote previews, the
 * frontmatter fold) — and times `view.dispatch` of one typed character, the
 * way an `input.type` keystroke arrives.
 *
 * WHAT THIS MEASURES, AND WHAT IT CANNOT — this is NOT keystroke-to-paint
 * latency:
 *
 *   - Measured: the transaction and everything synchronous behind it — state
 *     fields, the incremental Lezer parse, every ViewPlugin's `update`
 *     (decoration rebuilds), gutter marker computation, and CodeMirror's DOM
 *     reconciliation of the changed line. This is the JS a keystroke costs,
 *     and the part app code controls.
 *   - Not measured: layout, style recalc and paint (jsdom has no layout
 *     engine), or CodeMirror's measure cycle, which reads layout in a later
 *     animation frame and finds zeros here.
 *   - The viewport is jsdom's, not a window's. With no layout, CodeMirror
 *     renders a small viewport (~24 lines at the time of writing); a real
 *     window shows more, so any per-visible-line cost is larger in the app
 *     than here. Read a ratio off this bench, not an absolute.
 *   - `buildKeymapAndCompletion` (keymaps + autocompletion sources) is not
 *     included: typing a letter reaches it only via the completion plugin's
 *     own async path, not the synchronous dispatch timed here.
 *
 * Each iteration alternates typing a character and backspacing it, so the doc
 * stays the same size however many iterations the runner picks, and every
 * iteration is a real doc change at the same spot inside the viewport.
 */
import { describe, test } from 'vitest';

// `ipc/client.ts` captures `window.api` at import. Nothing on the keystroke
// path calls it; a proxy that answers every `api.x.y()` with `null` keeps the
// few extensions that reach for it on hover/click from throwing if they do.
(window as unknown as { api: unknown }).api = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => async () => null }) },
);

const { EditorView } = await import('@codemirror/view');
const { EditorState, Compartment } = await import('@codemirror/state');
const { buildExtensions } = await import('../../../src/renderer/lib/editor/build-extensions');
const { getEditorSettings } = await import('../../../src/renderer/lib/editor/settings');

// ── fixture ────────────────────────────────────────────────────────────────
// Same shape as preview-render.bench.ts's note: 60 sections of cited
// paragraphs, wiki-links, a typed link, math, tags, lists and footnotes.
const SECTIONS = 60;
function buildNote(): string {
  const lines: string[] = ['---', 'title: Literature review', 'tags: [review, bench]', '---', ''];
  for (let s = 0; s < SECTIONS; s++) {
    lines.push(`## Section ${s}: argument ${s}`, '');
    for (let p = 0; p < 4; p++) {
      lines.push(
        `Paragraph ${p} of section ${s} makes a claim about #topic-${s % 7} that ` +
          `rests on prior work [[cite::src-${(s * 4 + p) % 60}]] and relates to [[note-${(s + p) % 40}]]. ` +
          `The effect size is $d = 0.${p + 2}$ and it replicates in the follow-up study.[^f${s}]`,
        '',
      );
    }
    lines.push(`> Quoted evidence: [[quote::ex-${s}]] — see also [[supports::note-${s % 40}]].`, '');
    for (let i = 0; i < 20; i++) {
      lines.push(`- point ${i} in section ${s}, with *emphasis* and \`code\``);
    }
    lines.push('', `[^f${s}]: Footnote for section ${s}.`, '');
  }
  return lines.join('\n');
}
const NOTE = buildNote();

const notePaths = Array.from({ length: 40 }, (_, i) => `note-${i}.md`);
const compartment = (): InstanceType<typeof Compartment> => new Compartment();
const extensions = buildExtensions({
  plainTextOnce: false,
  getPlainText: () => false,
  filePath: 'review.md',
  initSettings: getEditorSettings(),
  fontSize: 14,
  themeCompartment: compartment(),
  fontSizeCompartment: compartment(),
  tabSizeCompartment: compartment(),
  wrapCompartment: compartment(),
  lineNumbersCompartment: compartment(),
  whitespaceCompartment: compartment(),
  onNavigate: undefined,
  onOpenSource: undefined,
  onOpenExcerpt: undefined,
  getNotePaths: () => notePaths,
  getAliases: () => [],
  onRunCell: () => Promise.reject(new Error('not run in a bench')),
  runAllRef: { run: null },
  onCreateNoteFromReference: undefined,
  getSavedSelection: () => null,
  setSavedSelection: () => {},
  showContextMenu: () => {},
  onImageDrop: () => {},
});

const parent = document.createElement('div');
document.body.appendChild(parent);
const view = new EditorView({ state: EditorState.create({ doc: NOTE, extensions }), parent });

// Type at the end of the first cited paragraph (line 8): inside the rendered
// viewport, where a user types, on a line carrying links, math and a tag.
const LINE = 8;
const at = view.state.doc.line(LINE).to;

// Fail loudly if the setup stopped exercising what it claims to: an editor
// that rendered nothing, or a fixture whose typing line fell outside the
// viewport, would time a near-no-op and report it as a speedup.
{
  const rendered = parent.querySelectorAll('.cm-line').length;
  const links = parent.querySelectorAll('.cm-clickable-link').length;
  const { from, to } = view.viewport;
  if (rendered === 0 || links === 0 || at < from || at > to || view.state.doc.lines < 1800) {
    throw new Error(
      `editor-typing bench setup is broken: ${rendered} rendered lines, ${links} link decorations, ` +
        `viewport ${from}-${to}, typing at ${at}, ${view.state.doc.lines} doc lines`,
    );
  }
}

let typed = false;
const NAME = 'editor keystroke: 1,900-line note, app extensions (no layout/paint)';

describe('renderer: typing in a large note (#2385)', () => {
  test(NAME, async ({ bench }) => {
    await bench(NAME, () => {
      view.dispatch(
        typed
          ? { changes: { from: at, to: at + 1 }, selection: { anchor: at }, userEvent: 'delete.backward' }
          : { changes: { from: at, insert: 'x' }, selection: { anchor: at + 1 }, userEvent: 'input.type' },
      );
      typed = !typed;
    }).run();
  });
});
