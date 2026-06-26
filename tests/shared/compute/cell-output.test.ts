/**
 * Find a compute cell's stored output by id (#832 pt 5 / #884).
 *
 * Locates the runnable fence carrying `{id=…}` and reads its companion
 * ```output block — the data a chart's `data.cell` form binds to.
 */

import { describe, it, expect } from 'vitest';
import { findCellOutput, findAdjacentOutputBlock } from '../../../src/shared/compute/cell-output';

const NOTE = `# Analysis

Some prose.

\`\`\`sql {id=a1b2c3d4}
SELECT month, revenue FROM sales
\`\`\`

\`\`\`output
{"type":"table","columns":["month","revenue"],"rows":[["Jan",100],["Feb",150]]}
\`\`\`

More prose.

\`\`\`sparql {id=ffffffff}
SELECT ?x WHERE { ?x a ?y }
\`\`\`

\`\`\`output
{"type":"error","message":"Bad query"}
\`\`\`
`;

describe('findCellOutput', () => {
  it('finds a table output for the cell with a matching id', () => {
    expect(findCellOutput(NOTE, 'a1b2c3d4')).toEqual({
      type: 'table',
      columns: ['month', 'revenue'],
      rows: [['Jan', 100], ['Feb', 150]],
    });
  });

  it('returns the error shape for a cell whose run failed', () => {
    expect(findCellOutput(NOTE, 'ffffffff')).toEqual({ type: 'error', message: 'Bad query' });
  });

  it('returns null for an unknown cell id', () => {
    expect(findCellOutput(NOTE, 'deadbeef')).toBeNull();
  });

  it('returns null when the cell exists but has no output block (never run)', () => {
    const doc = '```python {id=aaaa1111}\nprint(1)\n```\n\nno output here\n';
    expect(findCellOutput(doc, 'aaaa1111')).toBeNull();
  });

  it('does not match a fence in a non-cell language', () => {
    const doc = '```text {id=aaaa1111}\nnot a cell\n```\n\n```output\n{"type":"text","value":"x"}\n```\n';
    expect(findCellOutput(doc, 'aaaa1111')).toBeNull();
  });

  it('ignores an output block separated by prose (not adjacent)', () => {
    const doc = '```sql {id=aaaa1111}\nSELECT 1\n```\n\nintervening prose\n\n```output\n{"type":"table","columns":["a"],"rows":[[1]]}\n```\n';
    expect(findCellOutput(doc, 'aaaa1111')).toBeNull();
  });
});

describe('findAdjacentOutputBlock', () => {
  it('finds an output block immediately after a fence end', () => {
    const doc = '```sql\nSELECT 1\n```\n```output\n{"type":"text","value":"x"}\n```\n';
    const after = doc.indexOf('```output');
    const block = findAdjacentOutputBlock(doc, doc.indexOf('```\n') + 4);
    expect(block).not.toBeNull();
    expect(doc.slice(block!.from, block!.to)).toContain('"type":"text"');
    expect(block!.from).toBe(after);
  });
});
