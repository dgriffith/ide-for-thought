/**
 * @vitest-environment happy-dom
 *
 * The compute-cells run gutter (#238 / #1413) — markers, and what an edit
 * costs (#2385).
 *
 * `lineMarker` runs for every rendered line on every gutter update. It used to
 * stringify the whole doc and rescan it for fences on each call, so one
 * keystroke in a 3,000-line note paid (rendered lines × note size); the
 * typing bench's insert + delete went from 16.1ms to 4.6ms without it. The
 * fences are now indexed once per doc change. Gated on the SCAN COUNT, not a timing (#2229), and each count
 * assertion is paired with one on the markers, so an index that is never
 * rebuilt (zero scans, stale markers) fails too.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const scans = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../src/shared/compute/fences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/compute/fences')>();
  return {
    ...actual,
    findRunnableFences: (...args: Parameters<typeof actual.findRunnableFences>) => {
      scans.count++;
      return actual.findRunnableFences(...args);
    },
  };
});

const { computeCellsExtension } = await import('../../../src/renderer/lib/editor/compute-cells');

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.innerHTML = '';
});

function mount(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [computeCellsExtension({ runCell: async () => ({ ok: true, output: [] }) as never })],
    }),
  });
  return view;
}

function markers(v: EditorView): HTMLElement[] {
  return Array.from(v.dom.querySelectorAll<HTMLElement>('.cm-compute-run'));
}

const prose = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}.`).join('\n\n');
const DOC = `${prose}\n\n\`\`\`python\nx = 1\n\`\`\`\n\n${prose}\n\n\`\`\`sql\nSELECT 1\n\`\`\`\n`;

describe('compute-cells gutter', () => {
  it('marks each runnable fence, and a risky one as flagged', () => {
    const v = mount(DOC.replace('x = 1', 'import subprocess\nsubprocess.run(["ls"])'));
    const m = markers(v);
    expect(m).toHaveLength(2);
    expect(m[0]!.classList.contains('cm-compute-flagged')).toBe(true);
    expect(m[0]!.title).toContain('subprocess');
    expect(m[1]!.classList.contains('cm-compute-flagged')).toBe(false);
  });

  it('scans the doc once per edit, however many lines the gutter draws', () => {
    const v = mount(DOC);
    expect(markers(v)).toHaveLength(2);
    scans.count = 0;
    const at = v.state.doc.line(3).from;
    for (let i = 0; i < 10; i++) {
      v.dispatch({ changes: { from: at, insert: 'x' } });
      v.dispatch({ changes: { from: at, to: at + 1 } });
    }
    // 20 doc changes → 20 scans. The per-line version scanned once per
    // rendered line per update: 640 here.
    expect(scans.count).toBe(20);
    expect(markers(v)).toHaveLength(2);
  });

  it('picks up a fence added by an edit, and drops one removed by an edit', () => {
    const v = mount(DOC);
    v.dispatch({ changes: { from: 0, insert: '```python\ny = 2\n```\n\n' } });
    expect(markers(v)).toHaveLength(3);
    const text = v.state.doc.toString();
    const start = text.indexOf('```sql');
    v.dispatch({ changes: { from: start, to: text.indexOf('```\n', start + 6) + 4 } });
    expect(markers(v)).toHaveLength(2);
  });

  it('re-flags a fence whose code turns risky', () => {
    const v = mount(DOC);
    expect(markers(v)[0]!.classList.contains('cm-compute-flagged')).toBe(false);
    const at = v.state.doc.toString().indexOf('x = 1');
    v.dispatch({ changes: { from: at, to: at + 5, insert: 'import subprocess' } });
    expect(markers(v)[0]!.classList.contains('cm-compute-flagged')).toBe(true);
  });
});
