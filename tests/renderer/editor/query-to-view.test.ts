/**
 * @vitest-environment happy-dom
 *
 * "Convert to view" (#2947): the `:::query-list` / `:::query-table` at a
 * position, and replacing it with its object-view fence as one edit.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { convertQueryDirectiveToView, directiveAt } from '../../../src/renderer/lib/editor/query-to-view';

const DOC = [
  '# Plan', '',
  ':::query-table', 'title: Places', '---', 'SELECT ?path ?title WHERE {}', ':::', '',
  'Between.', '',
  ':::query-timeseries', 'SELECT ?d ?v WHERE {}', ':::', '',
].join('\n');
const posOf = (text: string) => DOC.indexOf(text);

describe('directiveAt (#2947)', () => {
  const doc = EditorState.create({ doc: DOC }).doc;
  it('finds the directive around a position — its opening line, body or closing line', () => {
    const close = posOf(':::\n\nBetween');
    for (const pos of [posOf(':::query-table'), posOf('title: Places'), posOf('SELECT ?path'), close]) {
      expect(directiveAt(doc, pos)).toMatchObject({ from: posOf(':::query-table'), to: close + 3 });
    }
  });

  it('is nothing outside one, or in a directive that isn\'t a list or table', () => {
    expect(directiveAt(doc, posOf('Between.'))).toBeNull();
    expect(directiveAt(doc, posOf('# Plan'))).toBeNull();
    expect(directiveAt(doc, posOf('SELECT ?d'))).toBeNull();
  });
});

describe('convertQueryDirectiveToView (#2947)', () => {
  it('replaces the directive with its fence, leaving the rest of the note alone; nothing elsewhere', () => {
    const view = new EditorView({ state: EditorState.create({ doc: DOC }) });
    expect(convertQueryDirectiveToView(view, posOf('SELECT ?path'))).toBe(true);
    const text = view.state.doc.toString();
    expect(text).toContain('```object-view\n{\n  "query": "SELECT ?path ?title WHERE {}",\n  "language": "sparql",\n  "layout": "table",\n  "title": "Places"\n}\n```');
    expect(text).not.toContain(':::query-table');
    expect(text).toContain(':::query-timeseries'); // the chart stays a directive
    expect(text.startsWith('# Plan\n\n```object-view')).toBe(true);
    expect(convertQueryDirectiveToView(view, text.indexOf('Between.'))).toBe(false);
    view.destroy();
  });
});
