import { describe, it, expect } from 'vitest';
import {
  planOutputEdit,
  findAdjacentOutputBlock,
  findRunnableFences,
  codeOf,
  resultToJson,
} from '../../../src/renderer/lib/editor/output-block';

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
});

describe('findAdjacentOutputBlock', () => {
  it('finds an output fence on the very next line', () => {
    const doc = '```sparql\nSELECT 1\n```\n```output\n{"type":"text","value":"42"}\n```\n';
    const [fence] = findRunnableFences(doc, ALLOWED);
    const existing = findAdjacentOutputBlock(doc, fence.endOffset);
    expect(existing).not.toBeNull();
    expect(doc.slice(existing!.from, existing!.to)).toContain('"type":"text"');
  });

  it('finds an output fence separated by one blank line', () => {
    const doc = '```sparql\nSELECT 1\n```\n\n```output\n"x"\n```\n';
    const [fence] = findRunnableFences(doc, ALLOWED);
    expect(findAdjacentOutputBlock(doc, fence.endOffset)).not.toBeNull();
  });

  it('ignores output blocks separated by prose', () => {
    const doc = '```sparql\nSELECT 1\n```\n\nA paragraph.\n\n```output\n"x"\n```\n';
    const [fence] = findRunnableFences(doc, ALLOWED);
    expect(findAdjacentOutputBlock(doc, fence.endOffset)).toBeNull();
  });

  it('ignores a non-output fence sitting adjacent', () => {
    const doc = '```sparql\nSELECT 1\n```\n```json\n{}\n```\n';
    const [fence] = findRunnableFences(doc, ALLOWED);
    expect(findAdjacentOutputBlock(doc, fence.endOffset)).toBeNull();
  });
});

describe('planOutputEdit', () => {
  const fence = { startOffset: 0, endOffset: 0, language: 'sparql' }; // will be overwritten per-test

  it('inserts a fresh output block when none exists below', () => {
    const doc = '```sparql\nSELECT 1\n```\n';
    const [f] = findRunnableFences(doc, ALLOWED);
    const edit = planOutputEdit(doc, f, { ok: true, output: { type: 'text', value: 'hello' } });
    // Replace at end of fence; no existing block.
    expect(edit.from).toBe(f.endOffset);
    expect(edit.to).toBe(f.endOffset);
    expect(edit.insert).toBe('\n```output\n{"type":"text","value":"hello"}\n```\n');
  });

  it('replaces an existing adjacent output block in place', () => {
    const doc = '```sparql\nSELECT 1\n```\n```output\n{"type":"text","value":"old"}\n```\n';
    const [f] = findRunnableFences(doc, ALLOWED);
    const edit = planOutputEdit(doc, f, { ok: true, output: { type: 'text', value: 'new' } });
    const next = doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
    expect(next).toBe('```sparql\nSELECT 1\n```\n```output\n{"type":"text","value":"new"}\n```\n');
  });

  it('writes an error output when the result is ok: false', () => {
    const doc = '```sparql\nBAD\n```\n';
    const [f] = findRunnableFences(doc, ALLOWED);
    const edit = planOutputEdit(doc, f, { ok: false, error: 'oops' });
    expect(edit.insert).toBe('\n```output\n{"type":"error","message":"oops"}\n```\n');
  });

  // Fence not needed here but silences the unused binding.
  void fence;
});

describe('resultToJson', () => {
  it('stringifies success payloads as their output value', () => {
    expect(resultToJson({ ok: true, output: { type: 'text', value: 'hi' } }))
      .toBe('{"type":"text","value":"hi"}');
  });

  it('wraps errors in a type:"error" envelope', () => {
    expect(resultToJson({ ok: false, error: 'boom' }))
      .toBe('{"type":"error","message":"boom"}');
  });
});
