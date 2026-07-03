/**
 * @vitest-environment happy-dom
 *
 * "Recompute all" batch runner (compute-cells.ts). Cells can depend on
 * prior cells' state, so the batch runs strictly top-to-bottom and halts
 * on the first error. We stand up a detached EditorView wired with the
 * extension, capture the `runAllRef` handle it populates, and drive it
 * against a fake executor.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  computeCellsExtension,
  type RunAllRef,
} from '../../../src/renderer/lib/editor/compute-cells';
import type { CellResult } from '../../../src/renderer/lib/ipc/client';

let view: EditorView;
afterEach(() => view?.destroy());

/**
 * Build an editor over `doc` with the compute extension. `runCell`
 * records each (language, code) call and returns whatever the map/fn
 * dictates (defaulting to a trivial ok result).
 */
function mk(
  doc: string,
  runCell: (language: string, code: string) => CellResult,
): { view: EditorView; runAll: RunAllRef; calls: Array<{ language: string; code: string }> } {
  const calls: Array<{ language: string; code: string }> = [];
  const runAll: RunAllRef = { run: null };
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        computeCellsExtension({
          runCell: (language, code) => {
            calls.push({ language, code });
            return Promise.resolve(runCell(language, code));
          },
          runAllRef: runAll,
        }),
      ],
    }),
  });
  return { view, runAll, calls };
}

const ok = (value: unknown): CellResult => ({ ok: true, value } as CellResult);

describe('runAll (Recompute all, #238)', () => {
  it('runs every runnable fence top to bottom', async () => {
    const doc = '```sql\nSELECT 1\n```\n\ntext\n\n```python\nprint(2)\n```\n';
    const { runAll, view: v, calls } = mk(doc, () => ok('r'));

    await runAll.run!(v);

    expect(calls).toEqual([
      { language: 'sql', code: 'SELECT 1' },
      { language: 'python', code: 'print(2)' },
    ]);
    // Both fences got an output block written beneath them.
    expect(v.state.doc.toString().match(/```output/g)?.length).toBe(2);
  });

  it('halts on the first error — later cells never run', async () => {
    const doc = '```sql\nA\n```\n\n```sql\nB\n```\n\n```sql\nC\n```\n';
    const { runAll, view: v, calls } = mk(doc, (_lang, code) =>
      code === 'B' ? { ok: false, error: 'boom' } : ok('r'),
    );

    await runAll.run!(v);

    // A ran, B ran and failed, C was skipped.
    expect(calls.map((c) => c.code)).toEqual(['A', 'B']);
    const out = v.state.doc.toString();
    // The failing cell's error output is still written…
    expect(out).toContain('boom');
    // …but the third cell has no output block.
    expect(out.match(/```output/g)?.length).toBe(2);
  });

  it('is a no-op on a note with no runnable fences', async () => {
    const { runAll, view: v, calls } = mk('# just prose\n\n```\nplain\n```\n', () => ok('r'));
    await runAll.run!(v);
    expect(calls).toEqual([]);
  });
});
