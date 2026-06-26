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
  insertVegaLiteDiagram,
  vegaLiteInserts,
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

describe('vega-lite chart scaffolds (#830)', () => {
  /** Pull the JSON body out of an inserted ```vega-lite … ``` block. */
  function fenceBody(doc: string): string {
    const m = doc.match(/^```vega-lite\n([\s\S]*?)\n```\n$/);
    if (!m) throw new Error(`not a vega-lite fence:\n${doc}`);
    return m[1];
  }

  const INLINE = ['Bar', 'Line', 'Area', 'Scatter', 'Time Series', 'Pie'];
  const BOUND = ['From SPARQL', 'From Table', 'From Cell'];

  it('offers inline scaffolds, the live-data scaffolds, then the empty block', () => {
    expect(vegaLiteInserts.map((t) => t.label)).toEqual([...INLINE, ...BOUND, 'Empty Block']);
  });

  it('the empty-block option inserts a bare fence with the cursor on the body line', () => {
    const v = mk('');
    insertVegaLiteDiagram(v);
    expect(v.state.doc.toString()).toBe('```vega-lite\n\n```\n');
    expect(v.state.selection.main.head).toBe('```vega-lite\n'.length);
  });

  function cursorInBody(v: EditorView, doc: string) {
    const head = v.state.selection.main.head;
    expect(head).toBeGreaterThan('```vega-lite\n'.length);
    expect(head).toBeLessThan(doc.length);
  }

  for (const { label, command } of vegaLiteInserts) {
    if (label === 'Empty Block') continue;
    const bound = BOUND.includes(label);
    it(`${label} scaffold inserts a valid spec (${bound ? 'bound' : 'inline'}), cursor for the first edit`, () => {
      const v = mk('');
      command(v);
      const doc = v.state.doc.toString();
      const spec = JSON.parse(fenceBody(doc)) as Record<string, unknown>;
      expect(spec.mark).toBeTruthy();
      const data = spec.data as { values?: unknown[]; sparql?: string; table?: string; cell?: string; url?: string };
      if (bound) {
        // A live-data form — exactly one of sparql / table / cell, no inline values.
        expect([data.sparql, data.table, data.cell].filter(Boolean)).toHaveLength(1);
        expect(data.values).toBeUndefined();
      } else {
        expect(Array.isArray(data.values)).toBe(true);
        expect(data.values!.length).toBeGreaterThan(0);
      }
      // #829 posture: no scaffold references remote data.
      expect(data.url).toBeUndefined();
      expect(JSON.stringify(spec)).not.toContain('"url"');
      cursorInBody(v, doc);
    });
  }

  it('adds a leading newline when not at the start of a line', () => {
    const v = mk('text', 4);
    vegaLiteInserts[0].command(v); // Bar
    expect(v.state.doc.toString().startsWith('text\n```vega-lite\n')).toBe(true);
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
