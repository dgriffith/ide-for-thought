/**
 * @vitest-environment happy-dom
 *
 * A plugin command's replacement (#2643): applied only to text that still
 * reads as it did, as one undoable change.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { replaceRangeIfUnchanged, type ViewCommandOps } from '../../../src/renderer/lib/editor/view-commands';

function viewOf(doc: string) {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [history()] }), parent: document.body });
  const ops: ViewCommandOps = { getView: () => view, getRunAllRef: () => ({}) as never, getContextMenu: () => null };
  return { view, ops };
}

describe('replaceRangeIfUnchanged (#2643)', () => {
  it('replaces the range, selects the result, and undoes in one step', () => {
    const { view, ops } = viewOf('# T\n- b\n- a\n');
    expect(replaceRangeIfUnchanged(ops, 4, 11, '- b\n- a', '- a\n- b')).toBe(true);
    expect(view.state.doc.toString()).toBe('# T\n- a\n- b\n');
    expect(view.state.selection.main).toMatchObject({ from: 4, to: 11 });
    undo(view);
    expect(view.state.doc.toString()).toBe('# T\n- b\n- a\n');
    view.destroy();
  });

  it('changes nothing when the text there changed, or the range is out of the document', () => {
    const { view, ops } = viewOf('- b\n- a typed more');
    expect(replaceRangeIfUnchanged(ops, 0, 7, '- b\n- x', 'sorted')).toBe(false);
    expect(replaceRangeIfUnchanged(ops, 0, 999, '- b', 'sorted')).toBe(false);
    expect(view.state.doc.toString()).toBe('- b\n- a typed more');
    view.destroy();
  });
});
