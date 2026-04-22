import { describe, it, expect } from 'vitest';
import {
  parseFenceInfo,
  stringifyFenceInfo,
  ensureCellId,
  rewriteFenceInfo,
} from '../../../src/shared/compute/cell-id';

describe('parseFenceInfo', () => {
  it('splits language and attrs', () => {
    expect(parseFenceInfo('sparql')).toEqual({ language: 'sparql', attrs: {} });
    expect(parseFenceInfo('sparql {id=abc123}')).toEqual({
      language: 'sparql',
      attrs: { id: 'abc123' },
    });
    expect(parseFenceInfo('python {id=x} {tag=chart}')).toEqual({
      language: 'python',
      attrs: { id: 'x', tag: 'chart' },
    });
  });

  it('handles empty info', () => {
    expect(parseFenceInfo('')).toEqual({ language: '', attrs: {} });
  });
});

describe('stringifyFenceInfo', () => {
  it('is the inverse of parseFenceInfo with alphabetical attr order', () => {
    const parsed = parseFenceInfo('python {tag=chart} {id=abc}');
    expect(stringifyFenceInfo(parsed)).toBe('python {id=abc} {tag=chart}');
  });

  it('returns just the language when attrs is empty', () => {
    expect(stringifyFenceInfo({ language: 'sql', attrs: {} })).toBe('sql');
  });
});

describe('ensureCellId', () => {
  it('returns the existing id without modifying the info string', () => {
    const r = ensureCellId('sparql {id=existing}', () => 'NEW');
    expect(r).toEqual({ id: 'existing', newInfo: 'sparql {id=existing}', wasNew: false });
  });

  it('injects a new id when none is present', () => {
    const r = ensureCellId('sparql', () => 'newid');
    expect(r).toEqual({ id: 'newid', newInfo: 'sparql {id=newid}', wasNew: true });
  });

  it('preserves other attrs when injecting', () => {
    const r = ensureCellId('python {tag=chart}', () => 'x');
    expect(r.id).toBe('x');
    expect(r.newInfo).toBe('python {id=x} {tag=chart}');
  });
});

describe('rewriteFenceInfo', () => {
  it('rewrites only the opening line at startOffset', () => {
    const doc = '```sparql\nSELECT 1\n```\n';
    const next = rewriteFenceInfo(doc, 0, 'sparql {id=abc}');
    expect(next).toBe('```sparql {id=abc}\nSELECT 1\n```\n');
  });

  it('preserves the backtick count when the fence uses more than three', () => {
    const doc = '````sparql\ncode\n````';
    const next = rewriteFenceInfo(doc, 0, 'sparql {id=x}');
    expect(next.startsWith('````sparql {id=x}\n')).toBe(true);
  });

  it('leaves the doc alone when startOffset isn’t at a fence', () => {
    const doc = 'just prose, not a fence';
    expect(rewriteFenceInfo(doc, 0, 'sparql {id=x}')).toBe(doc);
  });
});
