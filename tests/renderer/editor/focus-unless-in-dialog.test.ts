/**
 * @vitest-environment happy-dom
 *
 * Restoring a note's caret doesn't take the keyboard from a dialog (#2754):
 * the session restore runs late, and ⌘N during startup used to lose its typing
 * to the restored note's editor.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { restorePosition } from '../../../src/renderer/lib/editor/view-commands';

afterEach(() => { document.body.innerHTML = ''; });

function editor(): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ state: EditorState.create({ doc: 'hello world' }), parent });
}

function dialogField(): HTMLInputElement {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const input = document.createElement('input');
  dialog.appendChild(input);
  document.body.appendChild(dialog);
  input.focus();
  return input;
}

describe('restorePosition and focus (#2754)', () => {
  it('focuses the editor, as it always did, when nothing else has the keyboard', () => {
    const view = editor();
    restorePosition({ getView: () => view } as never, 5);
    expect(view.hasFocus).toBe(true);
    expect(view.state.selection.main.head).toBe(5);
  });

  it('restores the caret but leaves focus in an open dialog', () => {
    const view = editor();
    const field = dialogField();
    restorePosition({ getView: () => view } as never, 5);
    expect(document.activeElement).toBe(field);
    expect(view.state.selection.main.head).toBe(5);
  });
});
