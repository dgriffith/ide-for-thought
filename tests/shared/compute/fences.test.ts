import { describe, it, expect } from 'vitest';
import { findRunnableFences, codeOf } from '../../../src/shared/compute/fences';

const ALLOWED = new Set(['sparql', 'sql', 'python']);

describe('findRunnableFences (#238)', () => {
  it('finds fences whose language is in the allow-list', () => {
    const doc = [
      '# Note',
      '',
      '```sparql',
      'SELECT ?n WHERE { ?n a :Note }',
      '```',
      '',
      'prose',
      '',
      '```js',
      'console.log("ignored")',
      '```',
      '',
      '```sql',
      'SELECT 1',
      '```',
      '',
    ].join('\n');
    const fences = findRunnableFences(doc, ALLOWED);
    expect(fences.map((f) => f.language)).toEqual(['sparql', 'sql']);
    expect(fences[0].openingLine).toBe(3);
    expect(fences[0].closingLine).toBe(5);
  });

  it('extracts the inner code via codeOf', () => {
    const doc = '```sparql\nSELECT 1\nSELECT 2\n```\n';
    const [fence] = findRunnableFences(doc, ALLOWED);
    expect(codeOf(doc, fence)).toBe('SELECT 1\nSELECT 2');
  });

  it('skips unclosed fences rather than crashing', () => {
    const doc = '```sparql\nSELECT 1\n\n(no close)\n';
    expect(findRunnableFences(doc, ALLOWED)).toEqual([]);
  });

  it('is case-insensitive on the language tag', () => {
    const fences = findRunnableFences('```SPARQL\nx\n```\n', ALLOWED);
    expect(fences).toHaveLength(1);
    expect(fences[0].language).toBe('SPARQL');
  });

  it('endOffset stops at doc.length when the fence is the last line (no trailing newline)', () => {
    // Regression: running a fence that ended with no trailing \n set
    // endOffset past the doc end, and view.dispatch silently no-op'd.
    const doc = '# Title\n\n```sparql\nSELECT 1\n```';
    const [fence] = findRunnableFences(doc, ALLOWED);
    expect(fence.endOffset).toBe(doc.length);
  });

  it('endOffset includes the trailing newline when one is present', () => {
    const doc = '```sparql\nSELECT 1\n```\n';
    const [fence] = findRunnableFences(doc, ALLOWED);
    expect(fence.endOffset).toBe(doc.length);
    expect(doc[fence.endOffset - 1]).toBe('\n');
  });
});
