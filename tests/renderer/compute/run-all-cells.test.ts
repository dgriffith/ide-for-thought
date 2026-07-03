/**
 * Content-string batch runner behind the preview's "Recompute all"
 * (#238 follow-up). Mirrors the editor-side test
 * (`editor/compute-cells-run-all.test.ts`) but exercises the pure
 * string-threading helper the Preview component wraps.
 */

import { describe, it, expect } from 'vitest';
import { runAllCellsInContent } from '../../../src/renderer/lib/compute/run-all-cells';
import type { CellResult } from '../../../src/renderer/lib/ipc/client';

const LANGS = new Set(['sql', 'sparql', 'python']);
const ok = (value: unknown): CellResult => ({ ok: true, value } as CellResult);

describe('runAllCellsInContent (preview Recompute all)', () => {
  it('runs every runnable fence top to bottom and returns the spliced content', async () => {
    const content = '```sql\nSELECT 1\n```\n\ntext\n\n```python\nprint(2)\n```\n';
    const calls: Array<{ language: string; code: string }> = [];
    const applied: string[] = [];

    const final = await runAllCellsInContent(content, LANGS, {
      runCell: (language, code) => {
        calls.push({ language, code });
        return Promise.resolve(ok('r'));
      },
      apply: (c) => applied.push(c),
    });

    expect(calls).toEqual([
      { language: 'sql', code: 'SELECT 1' },
      { language: 'python', code: 'print(2)' },
    ]);
    // One apply per cell, and the final return equals the last applied content.
    expect(applied).toHaveLength(2);
    expect(final).toBe(applied[applied.length - 1]);
    expect(final.match(/```output/g)?.length).toBe(2);
  });

  it('halts on the first error — later cells never run', async () => {
    const content = '```sql\nA\n```\n\n```sql\nB\n```\n\n```sql\nC\n```\n';
    const calls: string[] = [];

    const final = await runAllCellsInContent(content, LANGS, {
      runCell: (_language, code) => {
        calls.push(code);
        return Promise.resolve(code === 'B' ? { ok: false, error: 'boom' } : ok('r'));
      },
      apply: () => {},
    });

    expect(calls).toEqual(['A', 'B']); // C skipped
    expect(final).toContain('boom'); // failing cell's error is written
    expect(final.match(/```output/g)?.length).toBe(2); // A + B only
  });

  it('catches a runCell rejection and writes it as an error output, then halts', async () => {
    const content = '```sql\nA\n```\n\n```sql\nB\n```\n';
    const calls: string[] = [];

    const final = await runAllCellsInContent(content, LANGS, {
      runCell: (_language, code) => {
        calls.push(code);
        return code === 'A' ? Promise.reject(new Error('kaboom')) : Promise.resolve(ok('r'));
      },
      apply: () => {},
    });

    expect(calls).toEqual(['A']); // rejection halts before B
    expect(final).toContain('kaboom');
  });

  it('toggles the running indicator on and off around each cell', async () => {
    const content = '```sql\nA\n```\n';
    const events: Array<[number, boolean]> = [];

    await runAllCellsInContent(content, LANGS, {
      runCell: () => Promise.resolve(ok('r')),
      apply: () => {},
      setRunning: (line, running) => events.push([line, running]),
    });

    expect(events).toEqual([
      [1, true],
      [1, false],
    ]);
  });

  it('is a no-op on content with no runnable fences', async () => {
    const content = '# prose\n\n```\nplain\n```\n';
    const calls: string[] = [];
    const final = await runAllCellsInContent(content, LANGS, {
      runCell: (_l, code) => {
        calls.push(code);
        return Promise.resolve(ok('r'));
      },
      apply: () => {},
    });
    expect(calls).toEqual([]);
    expect(final).toBe(content);
  });
});
