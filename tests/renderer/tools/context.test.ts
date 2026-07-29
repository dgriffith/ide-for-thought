/**
 * Unit tests for `gatherContext` (src/renderer/lib/tools/context.ts) — the
 * renderer-side helper that assembles a `ToolContext` bundle from the editor
 * selection, the active note/source tab, and graph/link/tag queries, driven by
 * a list of `ContextRequirement`s.
 *
 * We mock the two impure dependencies — the editor store and the `api` IPC
 * client — while exercising the *real* `extractClaimUri` helper and a *real*
 * CodeMirror `EditorState` so selection/line math is tested against the actual
 * library semantics rather than a hand-rolled fake.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

const h = vi.hoisted(() => {
  const api = {
    graph: {
      query: vi.fn(),
      sourceDetail: vi.fn(),
    },
    links: {
      outgoing: vi.fn(),
      backlinks: vi.fn(),
    },
    notebase: {
      readFile: vi.fn(),
    },
    tags: {
      list: vi.fn(),
      notesByTag: vi.fn(),
    },
  };
  const editor = {
    activeNoteTab: undefined as unknown,
    activeFilePath: null as string | null,
    activeSourceTab: undefined as unknown,
  };
  return { api, editor };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({
  getEditorStore: () => h.editor,
}));

import { gatherContext } from '../../../src/renderer/lib/tools/context';

/** Build a fake EditorView backed by a real EditorState so sliceDoc /
 *  doc.lineAt / selection.main reflect CodeMirror's actual behavior. */
function makeView(doc: string, anchor = 0, head = 0): EditorView {
  const state = EditorState.create({ doc, selection: { anchor, head } });
  return { state } as unknown as EditorView;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.editor.activeNoteTab = undefined;
  h.editor.activeFilePath = null;
  h.editor.activeSourceTab = undefined;
});

describe('gatherContext — baseline', () => {
  it('returns an empty context for no requirements', async () => {
    const ctx = await gatherContext([]);
    expect(ctx).toEqual({});
  });

  it('ignores editor-dependent requirements when no editorView is passed', async () => {
    const ctx = await gatherContext(['selectedText', 'selectionRange', 'claimUnderCursor']);
    expect(ctx).toEqual({});
  });
});

describe('selectedText', () => {
  it('captures the selected slice when a selection exists', async () => {
    const view = makeView('hello world', 0, 5);
    const ctx = await gatherContext(['selectedText'], view);
    expect(ctx.selectedText).toBe('hello');
  });

  it('leaves selectedText undefined for a cursor-only (empty) selection', async () => {
    const view = makeView('hello world', 3, 3);
    const ctx = await gatherContext(['selectedText'], view);
    expect(ctx.selectedText).toBeUndefined();
  });
});

describe('selectionRange', () => {
  it('reports offsets and 1-based line numbers for a single-line selection', async () => {
    // "hello world" — select "world" (offsets 6..11 on line 1).
    const view = makeView('hello world', 6, 11);
    const ctx = await gatherContext(['selectionRange'], view);
    expect(ctx.selectionStartOffset).toBe(6);
    expect(ctx.selectionEndOffset).toBe(11);
    expect(ctx.selectionStartLine).toBe(1);
    expect(ctx.selectionEndLine).toBe(1);
  });

  it('reports the visually-last line when the selection ends on a trailing newline', async () => {
    // doc: line1\nline2\nline3 ; select from start of line1 through the
    // newline after line2 (offset 12), which lands at the start of line3.
    const doc = 'line1\nline2\nline3';
    const to = 'line1\nline2\n'.length; // 12 — start of line 3
    const view = makeView(doc, 0, to);
    const ctx = await gatherContext(['selectionRange'], view);
    expect(ctx.selectionStartLine).toBe(1);
    // `to - 1` pulls the line at the newline (belongs to line 2), so the
    // reported end line is 2, not the empty line 3.
    expect(ctx.selectionEndLine).toBe(2);
  });

  it('leaves range fields undefined for a cursor-only selection', async () => {
    const view = makeView('abc', 1, 1);
    const ctx = await gatherContext(['selectionRange'], view);
    expect(ctx.selectionStartOffset).toBeUndefined();
    expect(ctx.selectionEndOffset).toBeUndefined();
  });
});

describe('claimUnderCursor', () => {
  const CLAIM = 'https://minerva.dev/c/claim-abc123';

  it('extracts the claim URI from the active selection and looks up its metadata', async () => {
    const doc = `See ${CLAIM} for details`;
    const from = doc.indexOf('https');
    const to = from + CLAIM.length;
    const view = makeView(doc, from, to);
    h.api.graph.query.mockResolvedValue({
      results: [{ label: 'A claim', sourceText: 'the source passage' }],
    });

    const ctx = await gatherContext(['claimUnderCursor'], view);

    expect(ctx.claimUri).toBe(CLAIM);
    expect(ctx.claimLabel).toBe('A claim');
    expect(ctx.claimSourceText).toBe('the source passage');
    expect(h.api.graph.query).toHaveBeenCalledOnce();
    // The URI is interpolated into the SPARQL query.
    expect(h.api.graph.query.mock.calls[0][0]).toContain(CLAIM);
  });

  it('falls back to the current line when there is no selection', async () => {
    const doc = `line one\n${CLAIM}\nline three`;
    // Cursor (empty selection) somewhere on line 2.
    const head = doc.indexOf('https') + 4;
    const view = makeView(doc, head, head);
    h.api.graph.query.mockResolvedValue({ results: [] });

    const ctx = await gatherContext(['claimUnderCursor'], view);

    expect(ctx.claimUri).toBe(CLAIM);
    // Empty result set — the URI resolves but no metadata is attached.
    expect(ctx.claimLabel).toBeUndefined();
    expect(ctx.claimSourceText).toBeUndefined();
  });

  it('defaults missing label/sourceText fields to empty strings', async () => {
    const view = makeView(CLAIM, 0, CLAIM.length);
    h.api.graph.query.mockResolvedValue({ results: [{}] });

    const ctx = await gatherContext(['claimUnderCursor'], view);

    expect(ctx.claimUri).toBe(CLAIM);
    expect(ctx.claimLabel).toBe('');
    expect(ctx.claimSourceText).toBe('');
  });

  it('leaves metadata empty when the graph query throws', async () => {
    const view = makeView(CLAIM, 0, CLAIM.length);
    h.api.graph.query.mockRejectedValue(new Error('graph not initialised'));

    const ctx = await gatherContext(['claimUnderCursor'], view);

    expect(ctx.claimUri).toBe(CLAIM);
    expect(ctx.claimLabel).toBeUndefined();
    expect(ctx.claimSourceText).toBeUndefined();
  });

  it('sets nothing (and does not query) when no claim URI is present', async () => {
    const view = makeView('just some prose with no claim', 0, 4);
    const ctx = await gatherContext(['claimUnderCursor'], view);
    expect(ctx.claimUri).toBeUndefined();
    expect(h.api.graph.query).not.toHaveBeenCalled();
  });
});

describe('fullNote', () => {
  it('populates note content/path/title from the active note tab', async () => {
    h.editor.activeNoteTab = {
      content: '# Body',
      relativePath: 'dir/note.md',
      fileName: 'note.md',
    };
    const ctx = await gatherContext(['fullNote']);
    expect(ctx.fullNoteContent).toBe('# Body');
    expect(ctx.fullNotePath).toBe('dir/note.md');
    // The `.md` extension is stripped from the title.
    expect(ctx.fullNoteTitle).toBe('note');
  });

  it('sets nothing when there is no active note tab', async () => {
    const ctx = await gatherContext(['fullNote']);
    expect(ctx.fullNoteContent).toBeUndefined();
  });
});

describe('relatedNotes', () => {
  it('gathers outgoing + backlinked notes and reads their content', async () => {
    h.editor.activeFilePath = 'current.md';
    h.api.links.outgoing.mockResolvedValue([
      { target: 'out.md' },
      { target: '' }, // falsy target is skipped
    ]);
    h.api.links.backlinks.mockResolvedValue([{ source: 'back.md' }, { source: null }]);
    h.api.notebase.readFile.mockImplementation(async (p: string) => `content of ${p}`);

    const ctx = await gatherContext(['relatedNotes']);

    expect(ctx.relatedNotes).toBeDefined();
    const byPath = Object.fromEntries((ctx.relatedNotes ?? []).map((n) => [n.path, n]));
    expect(Object.keys(byPath).sort()).toEqual(['back.md', 'out.md']);
    expect(byPath['out.md']).toEqual({
      path: 'out.md',
      title: 'out',
      content: 'content of out.md',
    });
  });

  it('does not gather related notes when there is no active file', async () => {
    const ctx = await gatherContext(['relatedNotes']);
    expect(ctx.relatedNotes).toBeUndefined();
    expect(h.api.links.outgoing).not.toHaveBeenCalled();
  });

  it('falls back to an empty array when a link lookup throws', async () => {
    h.editor.activeFilePath = 'current.md';
    h.api.links.outgoing.mockRejectedValue(new Error('boom'));
    h.api.links.backlinks.mockResolvedValue([]);
    const ctx = await gatherContext(['relatedNotes']);
    expect(ctx.relatedNotes).toEqual([]);
  });
});

describe('taggedNotes', () => {
  it('collects sibling notes sharing the active note\'s tags', async () => {
    h.editor.activeFilePath = 'current.md';
    h.api.tags.list.mockResolvedValue([{ tag: 'alpha' }, { tag: 'beta' }]);
    h.api.tags.notesByTag.mockImplementation(async (tag: string) => {
      if (tag === 'alpha') {
        // current.md carries #alpha, and so does sibling.md
        return [{ relativePath: 'current.md' }, { relativePath: 'sibling.md' }];
      }
      // #beta is not on current.md, so it is not one of the note's tags
      return [{ relativePath: 'other.md' }];
    });
    h.api.notebase.readFile.mockImplementation(async (p: string) => `body:${p}`);

    const ctx = await gatherContext(['taggedNotes']);

    expect(ctx.taggedNotes).toBeDefined();
    const paths = (ctx.taggedNotes ?? []).map((n) => n.path);
    // Only siblings under the shared tag (alpha); current.md is excluded and
    // #beta's notes never enter because current.md is not tagged beta.
    expect(paths).toEqual(['sibling.md']);
    expect(ctx.taggedNotes?.[0]).toEqual({
      path: 'sibling.md',
      title: 'sibling',
      content: 'body:sibling.md',
    });
  });

  it('does not gather tagged notes without an active file', async () => {
    const ctx = await gatherContext(['taggedNotes']);
    expect(ctx.taggedNotes).toBeUndefined();
    expect(h.api.tags.list).not.toHaveBeenCalled();
  });

  it('falls back to an empty array when a tag lookup throws', async () => {
    h.editor.activeFilePath = 'current.md';
    h.api.tags.list.mockRejectedValue(new Error('tags unavailable'));
    const ctx = await gatherContext(['taggedNotes']);
    expect(ctx.taggedNotes).toEqual([]);
  });
});

describe('source context (#103)', () => {
  it('fills sourceMetadata + title from the active source tab', async () => {
    h.editor.activeSourceTab = { sourceId: 'src-1' };
    h.api.graph.sourceDetail.mockResolvedValue({
      metadata: { title: 'A Paper', year: '2020' },
    });

    const ctx = await gatherContext(['sourceMetadata']);

    expect(ctx.sourceId).toBe('src-1');
    expect(ctx.sourceMetadata).toEqual({ title: 'A Paper', year: '2020' });
    expect(ctx.sourceTitle).toBe('A Paper');
    // sourceBody was not requested, so no body read.
    expect(h.api.notebase.readFile).not.toHaveBeenCalled();
  });

  it('defaults sourceTitle to empty when metadata has no title', async () => {
    h.editor.activeSourceTab = { sourceId: 'src-2' };
    h.api.graph.sourceDetail.mockResolvedValue({ metadata: {} });
    const ctx = await gatherContext(['sourceMetadata']);
    expect(ctx.sourceTitle).toBe('');
  });

  it('leaves metadata empty (but keeps sourceId) when sourceDetail throws', async () => {
    h.editor.activeSourceTab = { sourceId: 'src-3' };
    h.api.graph.sourceDetail.mockRejectedValue(new Error('unknown source'));
    const ctx = await gatherContext(['sourceMetadata']);
    expect(ctx.sourceId).toBe('src-3');
    expect(ctx.sourceMetadata).toBeUndefined();
    expect(ctx.sourceTitle).toBeUndefined();
  });

  it('reads body.md for sourceBody from the expected path', async () => {
    h.editor.activeSourceTab = { sourceId: 'src-4' };
    h.api.notebase.readFile.mockResolvedValue('extracted body text');
    const ctx = await gatherContext(['sourceBody']);
    expect(ctx.sourceBody).toBe('extracted body text');
    expect(h.api.notebase.readFile).toHaveBeenCalledWith('.minerva/sources/src-4/body.md');
  });

  it('leaves sourceBody undefined when the body read throws', async () => {
    h.editor.activeSourceTab = { sourceId: 'src-5' };
    h.api.notebase.readFile.mockRejectedValue(new Error('no body.md'));
    const ctx = await gatherContext(['sourceBody']);
    expect(ctx.sourceId).toBe('src-5');
    expect(ctx.sourceBody).toBeUndefined();
  });

  it('gathers metadata and body together when both are requested', async () => {
    h.editor.activeSourceTab = { sourceId: 'src-6' };
    h.api.graph.sourceDetail.mockResolvedValue({ metadata: { title: 'Both' } });
    h.api.notebase.readFile.mockResolvedValue('body!');
    const ctx = await gatherContext(['sourceMetadata', 'sourceBody']);
    expect(ctx.sourceTitle).toBe('Both');
    expect(ctx.sourceBody).toBe('body!');
  });

  it('does nothing source-related when no source tab is active', async () => {
    const ctx = await gatherContext(['sourceMetadata', 'sourceBody']);
    expect(ctx.sourceId).toBeUndefined();
    expect(h.api.graph.sourceDetail).not.toHaveBeenCalled();
    expect(h.api.notebase.readFile).not.toHaveBeenCalled();
  });
});

describe('composition', () => {
  it('assembles multiple requirements into one bundle', async () => {
    const view = makeView('pick this text', 0, 4);
    h.editor.activeNoteTab = {
      content: 'note body',
      relativePath: 'n.md',
      fileName: 'n.md',
    };
    const ctx = await gatherContext(['selectedText', 'fullNote'], view);
    expect(ctx.selectedText).toBe('pick');
    expect(ctx.fullNoteContent).toBe('note body');
    expect(ctx.fullNoteTitle).toBe('n');
  });
});
