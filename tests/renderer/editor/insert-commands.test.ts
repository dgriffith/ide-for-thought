/**
 * @vitest-environment happy-dom
 *
 * Fenced-block (Query / Python / Mermaid) and Callout insert commands added
 * to the editor right-click menu. They're full CodeMirror commands, so we
 * stand up a detached EditorView and assert the resulting doc + cursor.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  insertSqlQuery,
  insertSparqlQuery,
  insertPythonScript,
  insertMermaidDiagram,
  insertCallouts,
} from '../../../src/renderer/lib/editor/formatting';

let view: EditorView;
afterEach(() => view?.destroy());

function mk(doc: string, pos = doc.length): EditorView {
  view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: pos } }) });
  return view;
}

describe('fenced-block inserts', () => {
  it('insertSqlQuery inserts a ```sql fence with the cursor on the body line', () => {
    const v = mk('');
    insertSqlQuery(v);
    expect(v.state.doc.toString()).toBe('```sql\n\n```\n');
    expect(v.state.selection.main.head).toBe('```sql\n'.length); // empty body line
  });

  it('insertSparqlQuery / insertPythonScript / insertMermaidDiagram use the right language', () => {
    expect((insertSparqlQuery(mk('')), view.state.doc.toString())).toBe('```sparql\n\n```\n');
    expect((insertPythonScript(mk('')), view.state.doc.toString())).toBe('```python\n\n```\n');
    expect((insertMermaidDiagram(mk('')), view.state.doc.toString())).toBe('```mermaid\n\n```\n');
  });

  it('adds a leading newline when not at the start of a line', () => {
    const v = mk('text', 4);
    insertSqlQuery(v);
    expect(v.state.doc.toString()).toBe('text\n```sql\n\n```\n');
  });
});

describe('callout inserts', () => {
  it('exposes all 13 supported callout types', () => {
    expect(insertCallouts.map((c) => c.type)).toEqual([
      'note', 'abstract', 'info', 'tip', 'success', 'question',
      'warning', 'failure', 'danger', 'bug', 'example', 'quote', 'todo',
    ]);
  });

  it('inserts a `> [!type]` callout with the cursor on the body line', () => {
    const note = insertCallouts.find((c) => c.type === 'note')!;
    const v = mk('');
    note.command(v);
    expect(v.state.doc.toString()).toBe('> [!note]\n> ');
    expect(v.state.selection.main.head).toBe('> [!note]\n> '.length);
  });

  it('wraps a selection as the callout body', () => {
    const warn = insertCallouts.find((c) => c.type === 'warning')!;
    const v = mk('line one\nline two', 0);
    v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
    warn.command(v);
    expect(v.state.doc.toString()).toBe('> [!warning]\n> line one\n> line two\n');
  });
});
