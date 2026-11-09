/**
 * @vitest-environment jsdom
 *
 * The editor's section commands (#2963), on a real CodeMirror view: Move
 * Section Up / Down (a heading section or the list item at the cursor),
 * Promote / Demote Heading (the heading the cursor is in) — each one undo
 * step, the cursor kept in the section, and a refusal said, not dropped.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';

const said = vi.hoisted(() => ({ messages: [] as string[] }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: (m: string) => { said.messages.push(m); } }));
import { moveSectionUp, moveSectionDown, promoteHeading, demoteHeading } from '../../../src/renderer/lib/editor/outline-commands';

const NOTE = '# Trip\n\n## Pack\n\n- clothes\n- papers\n\n## Book\n\nTrains.\n\n### Hotel\n\n## Go\n';
let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; said.messages = []; });

function open(text: string, cursorAt: string): EditorView {
  view = new EditorView({ state: EditorState.create({ doc: text, selection: { anchor: text.indexOf(cursorAt) + 1 }, extensions: [history()] }), parent: document.body });
  return view;
}
const text = (v: EditorView) => v.state.doc.toString();
const lineAtCursor = (v: EditorView) => v.state.doc.lineAt(v.state.selection.main.head).text;

describe('section commands (#2963)', () => {
  it('Move Section Down: the section the cursor is in, past the next, the cursor along with it; one undo', () => {
    const v = open(NOTE, 'Trains');
    expect(moveSectionDown(v)).toBe(true);
    expect(text(v)).toBe('# Trip\n\n## Pack\n\n- clothes\n- papers\n\n## Go\n## Book\n\nTrains.\n\n### Hotel\n\n');
    expect(lineAtCursor(v)).toBe('Trains.');
    expect(said.messages).toEqual(['Moved “Book” down']);
    undo(v);
    expect(text(v)).toBe(NOTE);
  });

  it('Move Section Up on a list item moves the item', () => {
    const v = open(NOTE, 'papers');
    moveSectionUp(v);
    expect(text(v)).toBe(NOTE.replace('- clothes\n- papers\n', '- papers\n- clothes\n'));
    expect(lineAtCursor(v)).toBe('- papers');
  });

  it('Promote Heading makes the heading its parent\'s next sibling; Demote puts it under the one before', () => {
    const v = open(NOTE, 'Hotel');
    promoteHeading(v);
    expect(text(v)).toBe(NOTE.replace('### Hotel', '## Hotel'));
    expect(lineAtCursor(v)).toBe('## Hotel');
    demoteHeading(v);
    expect(text(v)).toBe(NOTE);
  });

  it('acts on the heading the cursor is in, from its body or a list in it', () => {
    const v = open(NOTE, 'papers');
    demoteHeading(v); // Pack has no heading before it at its level
    expect(said.messages).toEqual(['There\'s nothing before it to go under.']);
    expect(text(v)).toBe(NOTE);
  });

  it('says why when it can\'t, and changes nothing', () => {
    const v = open(NOTE, 'Pack');
    moveSectionUp(v);
    expect(said.messages).toEqual(['It\'s already first.']);
    expect(text(v)).toBe(NOTE);
  });

  it('does nothing (and lets the key through) outside any section', () => {
    const v = open('Just a paragraph.\n', 'Just');
    expect(moveSectionUp(v)).toBe(false);
    expect(promoteHeading(v)).toBe(false);
  });
});
