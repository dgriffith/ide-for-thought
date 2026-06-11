// @vitest-environment jsdom
/**
 * Compute-output rendering + clipboard helpers (#672).
 */
import { describe, it, expect } from 'vitest';
import type Token from 'markdown-it/lib/token.mjs';
import {
  findSourceFenceBefore,
  renderComputeOutput,
  tableToCsv,
  outputToMarkdownClipboard,
} from '../../../src/renderer/lib/preview/compute-output-render';
import type { CellOutput } from '../../../src/shared/compute/types';

function tok(type: string, info = '', content = ''): Token {
  return { type, info, content } as unknown as Token;
}

describe('renderComputeOutput', () => {
  it('renders a text payload', () => {
    const html = renderComputeOutput(JSON.stringify({ type: 'text', value: 'hi <b>' }), null);
    expect(html).toContain('compute-output-text');
    expect(html).toContain('hi &lt;b&gt;');
  });
  it('renders a table payload', () => {
    const html = renderComputeOutput(
      JSON.stringify({ type: 'table', columns: ['a', 'b'], rows: [[1, 2]] }),
      null,
    );
    expect(html).toContain('compute-output-table');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>1</td>');
  });
  it('renders a json payload', () => {
    const html = renderComputeOutput(JSON.stringify({ type: 'json', value: { k: 1 } }), null);
    expect(html).toContain('compute-output-json');
    expect(html).toContain('"k": 1');
  });
  it('renders an error payload without a wrap menu', () => {
    const html = renderComputeOutput(
      JSON.stringify({ type: 'error', message: 'boom' }),
      { language: 'python', code: 'x' },
    );
    expect(html).toContain('compute-output-error');
    expect(html).toContain('boom');
    expect(html).not.toContain('compute-output-wrap');
  });
  it('renders unparseable content as a raw pre', () => {
    const html = renderComputeOutput('not json {', null);
    expect(html).toContain('compute-output-raw');
    expect(html).toContain('not json {');
  });
  it('wraps a saveable result with a source in the overflow menu', () => {
    const html = renderComputeOutput(
      JSON.stringify({ type: 'text', value: 'hi' }),
      { language: 'python', code: 'print(1)' },
    );
    expect(html).toContain('compute-output-wrap');
    expect(html).toContain('compute-output-menu-btn');
    expect(html).toContain('⋯');
  });
  it('does not wrap a saveable result when there is no source', () => {
    const html = renderComputeOutput(JSON.stringify({ type: 'text', value: 'hi' }), null);
    expect(html).not.toContain('compute-output-wrap');
  });
});

describe('tableToCsv', () => {
  it('quotes cells with comma / quote / newline and doubles inner quotes', () => {
    const csv = tableToCsv(['a', 'b'], [['x,y', 'he said "hi"'], ['line1\nline2', 'plain']]);
    expect(csv).toBe('a,b\r\n"x,y","he said ""hi"""\r\n"line1\nline2",plain');
  });
});

describe('outputToMarkdownClipboard', () => {
  it('renders a table as a markdown pipe table', () => {
    const out: CellOutput = { type: 'table', columns: ['a', 'b'], rows: [['1', '2']] };
    expect(outputToMarkdownClipboard(out)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });
  it('renders an empty table as the empty marker', () => {
    const out: CellOutput = { type: 'table', columns: [], rows: [] };
    expect(outputToMarkdownClipboard(out)).toBe('*(empty result)*');
  });
  it('renders text as a fenced block', () => {
    const out: CellOutput = { type: 'text', value: 'hello\n' };
    expect(outputToMarkdownClipboard(out)).toBe('```\nhello\n```');
  });
});

describe('findSourceFenceBefore', () => {
  it('returns the nearest preceding runnable fence', () => {
    const tokens = [
      tok('fence', 'sparql', 'SELECT * WHERE {}\n'),
      tok('fence', 'output', '{}'),
    ];
    expect(findSourceFenceBefore(tokens, 1)).toEqual({
      language: 'sparql',
      code: 'SELECT * WHERE {}',
    });
  });
  it('returns null when a heading intervenes', () => {
    const tokens = [
      tok('fence', 'python', 'print(1)\n'),
      tok('heading_open', 'h2'),
      tok('fence', 'output', '{}'),
    ];
    expect(findSourceFenceBefore(tokens, 2)).toBeNull();
  });
  it('returns null when a paragraph intervenes', () => {
    const tokens = [
      tok('fence', 'sql', 'SELECT 1\n'),
      tok('paragraph_open'),
      tok('fence', 'output', '{}'),
    ];
    expect(findSourceFenceBefore(tokens, 2)).toBeNull();
  });
  it('returns null when there is no preceding fence', () => {
    const tokens = [tok('fence', 'output', '{}')];
    expect(findSourceFenceBefore(tokens, 0)).toBeNull();
  });
  it('returns null when the preceding fence is not runnable', () => {
    const tokens = [
      tok('fence', 'text', 'hi\n'),
      tok('fence', 'output', '{}'),
    ];
    expect(findSourceFenceBefore(tokens, 1)).toBeNull();
  });
});
