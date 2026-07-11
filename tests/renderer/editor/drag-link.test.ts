/**
 * @vitest-environment jsdom
 *
 * Drag-to-add-link (#1129) — the link-format contract and the HTML5 payload
 * round-trip. The inserted text must match what the wiki-link autocomplete
 * produces: `[[<stem>]]` for a note, `[[cite::<id>]]` for a source.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  wikiLinkForItem,
  draggedItemFromDataTransfer,
  dataTransferHasItem,
  insertWikiLinkAtPos,
  DRAG_MIME_NOTE,
  DRAG_MIME_SOURCE,
} from '../../../src/renderer/lib/editor/drag-link';

/** Minimal DataTransfer stub — only the bits the helpers read. */
function dt(data: Record<string, string>): DataTransfer {
  return {
    getData: (t: string) => data[t] ?? '',
    types: Object.keys(data),
  } as unknown as DataTransfer;
}

describe('wikiLinkForItem (#1129)', () => {
  it('formats a note as its extensionless stem', () => {
    expect(wikiLinkForItem({ kind: 'note', path: 'notes/topic/raft.md', label: 'Raft' }))
      .toBe('[[notes/topic/raft]]');
  });

  it('formats a source as a cite link', () => {
    expect(wikiLinkForItem({ kind: 'source', sourceId: 'smith-2023', label: 'Smith 2023' }))
      .toBe('[[cite::smith-2023]]');
  });
});

describe('dataTransfer round-trip', () => {
  it('reads a note payload', () => {
    expect(draggedItemFromDataTransfer(dt({ [DRAG_MIME_NOTE]: 'a/b.md' })))
      .toEqual({ kind: 'note', path: 'a/b.md', label: 'a/b.md' });
  });

  it('reads a source payload', () => {
    expect(draggedItemFromDataTransfer(dt({ [DRAG_MIME_SOURCE]: 'doi-1' })))
      .toEqual({ kind: 'source', sourceId: 'doi-1', label: 'doi-1' });
  });

  it('returns null for a foreign drag (no internal payload)', () => {
    expect(draggedItemFromDataTransfer(dt({ 'text/plain': 'hello' }))).toBeNull();
  });

  it('dataTransferHasItem detects the MIME on dragover', () => {
    expect(dataTransferHasItem(dt({ [DRAG_MIME_NOTE]: 'x' }))).toBe(true);
    expect(dataTransferHasItem(dt({ [DRAG_MIME_SOURCE]: 'x' }))).toBe(true);
    expect(dataTransferHasItem(dt({ 'text/plain': 'x' }))).toBe(false);
  });
});

describe('insertWikiLinkAtPos', () => {
  function view(doc: string): EditorView {
    return new EditorView({ state: EditorState.create({ doc }), parent: document.body });
  }

  it('inserts at the position and moves the cursor after the link', () => {
    const v = view('one two');
    insertWikiLinkAtPos(v, 3, '[[note]]'); // right after "one"
    expect(v.state.doc.toString()).toBe('one [[note]] two');
    expect(v.state.selection.main.head).toBe(3 + ' [[note]]'.length);
    v.destroy();
  });

  it('adds a leading space only when dropping mid-word', () => {
    const atWordEnd = view('foo');
    insertWikiLinkAtPos(atWordEnd, 3, '[[x]]');
    expect(atWordEnd.state.doc.toString()).toBe('foo [[x]]'); // space added after "foo"
    atWordEnd.destroy();

    const afterSpace = view('foo ');
    insertWikiLinkAtPos(afterSpace, 4, '[[x]]');
    expect(afterSpace.state.doc.toString()).toBe('foo [[x]]'); // no double space
    afterSpace.destroy();

    const atLineStart = view('');
    insertWikiLinkAtPos(atLineStart, 0, '[[x]]');
    expect(atLineStart.state.doc.toString()).toBe('[[x]]'); // no leading space at start
    atLineStart.destroy();
  });
});
