import { describe, it, expect } from 'vitest';
import { docFromText } from '../../src/renderer/lib/editor/frontmatter';
import { findHiddenFenceFoldRanges } from '../../src/renderer/lib/editor/hidden-fences';

// Mirrors editor-frontmatter.test.ts's shape: a pure LineDoc scan, unit-tested
// without a live CodeMirror view. docFromText gives CM-parity offsets.

describe('findHiddenFenceFoldRanges (#2039)', () => {
  it('spans from the end of the opening fence to the end of the closing fence', () => {
    // ```turtle-hidden\nex:A ex:r ex:B .\n```\n
    const text = '```turtle-hidden\nex:A ex:r ex:B .\n```\nbody';
    const ranges = findHiddenFenceFoldRanges(docFromText(text));
    expect(ranges).toHaveLength(1);
    // Both fence lines stay visible — the fold begins after the opening
    // fence line and ends at the closing fence's line end.
    expect(text.slice(ranges[0]!.from, ranges[0]!.to)).toBe('\nex:A ex:r ex:B .\n```');
  });

  it('ignores a plain (non-hidden) fence', () => {
    expect(findHiddenFenceFoldRanges(docFromText('```turtle\nex:A ex:r ex:B .\n```'))).toEqual([]);
  });

  it('returns a range per hidden fence, skipping non-hidden ones in between', () => {
    const text = [
      '```python-hidden',
      'print(1)',
      '```',
      '',
      '```mermaid',
      'graph TD',
      '```',
      '',
      '```turtle-hidden',
      'ex:A ex:r ex:B .',
      '```',
    ].join('\n');
    const ranges = findHiddenFenceFoldRanges(docFromText(text));
    expect(ranges).toHaveLength(2);
  });

  it('returns no range for an unclosed hidden fence', () => {
    expect(findHiddenFenceFoldRanges(docFromText('```turtle-hidden\nex:A ex:r ex:B .\nno close'))).toEqual([]);
  });

  it('returns no ranges for a doc with no fences', () => {
    expect(findHiddenFenceFoldRanges(docFromText('# Title\n\nbody'))).toEqual([]);
  });

  it('tolerates surrounding whitespace on the fence lines (trim)', () => {
    const ranges = findHiddenFenceFoldRanges(docFromText('```turtle-hidden  \nex:A .\n  ```\nx'));
    expect(ranges).toHaveLength(1);
  });

  it('does not scan inside a fence body for a nested opening marker', () => {
    // A hidden fence's body containing literal backtick-looking text must not
    // be mistaken for a new fence boundary.
    const text = '```turtle-hidden\nex:A ex:r "```fake```" .\n```\nafter';
    const ranges = findHiddenFenceFoldRanges(docFromText(text));
    expect(ranges).toHaveLength(1);
  });
});
