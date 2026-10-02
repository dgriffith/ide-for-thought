/**
 * Live blocks in exports (#2510), main side: placeholders, the failure modes
 * that must never fail an export, and splicing with link resolution.
 */
import { describe, it, expect } from 'vitest';
import { extractLiveBlocks, renderLiveBlocks, spliceLiveBlocks } from '../../../src/main/publish/live-blocks';
import MarkdownIt from 'markdown-it';

const NOTE = 'Intro\n\n```object-view\n{"typeId":"place","layout":"table"}\n```\n\nMiddle\n\n```object-view-hidden\n{"typeId":"x","layout":"list"}\n```\n\n```object-view\n{"typeId":"museum","layout":"list"}\n```\n\nEnd';

describe('extractLiveBlocks', () => {
  it('swaps each (visible) block for a placeholder, in order, with its exact source', () => {
    const { markdown, blocks } = extractLiveBlocks(NOTE, 'trip/plan.md');
    expect(blocks.map((b) => [b.kind, b.source.trim(), b.notePath])).toEqual([
      ['object-view', '{"typeId":"place","layout":"table"}', 'trip/plan.md'],
      ['object-view', '{"typeId":"museum","layout":"list"}', 'trip/plan.md'],
    ]);
    expect(markdown).not.toContain('"place"');
    expect(markdown).toContain('object-view-hidden'); // hidden fences are the renderer's to drop
    // Each placeholder renders as its own paragraph, untouched by markdown.
    const html = new MarkdownIt().render(markdown);
    for (const b of blocks) expect(html).toContain(`<p>${b.id}</p>`);
  });

  it('leaves a note without live blocks byte-identical', () => {
    const src = 'Just prose\n\n```python\nprint(1)\n```\n';
    expect(extractLiveBlocks(src, 'a.md')).toEqual({ markdown: src, blocks: [] });
  });
});

describe('renderLiveBlocks — never fails an export', () => {
  const { blocks } = extractLiveBlocks(NOTE, 'p.md');

  it('with no renderer, every block becomes an explained error', async () => {
    const res = await renderLiveBlocks(blocks, undefined);
    expect([...res.values()].every((r) => !r.ok && /open Minerva window/.test(r.error))).toBe(true);
  });

  it('a renderer that throws, or answers for only some blocks, still yields a result per block', async () => {
    const thrown = await renderLiveBlocks(blocks, () => Promise.reject(new Error('rendering timed out')));
    expect([...thrown.values()].map((r) => (r.ok ? '' : r.error))).toEqual(['rendering timed out', 'rendering timed out']);
    const partial = await renderLiveBlocks(blocks, async (bs) => [{ id: bs[0]!.id, ok: true, html: '<div>v</div>' }]);
    expect(partial.get(blocks[0]!.id)!.ok).toBe(true);
    expect(partial.get(blocks[1]!.id)!.ok).toBe(false);
  });
});

describe('spliceLiveBlocks', () => {
  const id = 'MINERVALIVEBLOCK0Z';
  const html = `<p>before</p>\n<p>${id}</p>\n<p>after</p>`;

  it('puts the block where its placeholder rendered, resolving its note links', () => {
    const results = new Map([[id, { id, ok: true as const, html: '<div><a class="row" data-note-link="places/Caf&amp;é &quot;X&quot;.md">X</a></div>' }]]);
    const out = spliceLiveBlocks(html, results, (p) => (p === 'places/Caf&é "X".md' ? 'places/Caf&é "X".html' : null));
    expect(out).toContain('<p>before</p>\n<div><a class="row" href="places/Caf&amp;é &quot;X&quot;.html">X</a></div>\n<p>after</p>');
    expect(out).not.toContain('data-note-link');
  });

  it('drops the link (keeping the text) when the export policy does not link', () => {
    const results = new Map([[id, { id, ok: true as const, html: '<a data-note-link="a.md">A</a>' }]]);
    expect(spliceLiveBlocks(html, results, () => null)).toContain('<a>A</a>');
  });

  it('replaces a failed block with a one-line note, never the raw spec', () => {
    const results = new Map([[id, { id, ok: false as const, error: 'the view took too long to load' }]]);
    const out = spliceLiveBlocks(html, results, () => null);
    expect(out).toContain("This view couldn&#39;t be rendered for export: the view took too long to load");
    expect(out).not.toContain(id);
  });
});

describe('extractLiveBlocks — :::query-* directives (#2512)', () => {
  const NOTE_Q = [
    'Top',
    '',
    ':::query-list',
    'title: Museums',
    '---',
    'SELECT ?n WHERE { ?n a minerva:Note }',
    ':::',
    '',
    '```object-view',
    '{"typeId":"place","layout":"list"}',
    '```',
    '',
    ':::query-backlinks',
    ':::',
    '',
    '```markdown',
    ':::query-list',
    'SELECT ?quoted WHERE {}',
    ':::',
    '```',
    '',
    '    :::query-table',
    '    SELECT ?indented WHERE {}',
    '    :::',
    '',
    ':::query-table',
    'SELECT ?never_closed WHERE {}',
  ].join('\n');

  it('extracts each directive whole, in document order with fences', () => {
    const { blocks, markdown } = extractLiveBlocks(NOTE_Q, 'n.md');
    expect(blocks.map((b) => b.kind)).toEqual(['query', 'object-view', 'query']);
    expect(blocks[0]!.source).toBe(':::query-list\ntitle: Museums\n---\nSELECT ?n WHERE { ?n a minerva:Note }\n:::');
    expect(blocks[2]!.source).toBe(':::query-backlinks\n:::');
    expect(markdown).not.toContain('SELECT ?n WHERE');
  });

  it('leaves a directive quoted in a code block, an indented one, and an unclosed one alone', () => {
    const { markdown } = extractLiveBlocks(NOTE_Q, 'n.md');
    expect(markdown).toContain('SELECT ?quoted WHERE {}');
    expect(markdown).toContain('SELECT ?indented WHERE {}');
    expect(markdown).toContain('SELECT ?never_closed WHERE {}');
  });
});

describe('extractLiveBlocks — mermaid (#2513)', () => {
  it('extracts a ```mermaid fence with its exact source, but not a hidden one', () => {
    const { blocks } = extractLiveBlocks('A\n\n```mermaid\ngraph TD; A-->B\n```\n\n```mermaid-hidden\ngraph TD; X-->Y\n```\n', 'n.md');
    expect(blocks.map((b) => [b.kind, b.source.trim()])).toEqual([['mermaid', 'graph TD; A-->B']]);
  });
});

describe('extractLiveBlocks — :::argument (#2514)', () => {
  it('extracts an argument directive whole, alongside query directives', () => {
    const { blocks } = extractLiveBlocks('A\n\n:::argument\ndepth: 2\n---\n[[Claim A]]\n:::\n\n:::query-backlinks\n:::\n', 'n.md');
    expect(blocks.map((b) => [b.kind, b.source])).toEqual([
      ['argument', ':::argument\ndepth: 2\n---\n[[Claim A]]\n:::'],
      ['query', ':::query-backlinks\n:::'],
    ]);
  });
});

describe('extractLiveBlocks — output (#2515)', () => {
  it('extracts a saved cell output, leaving its source cell alone', () => {
    const { blocks, markdown } = extractLiveBlocks('```python\nprint(1)\n```\n\n```output\n{"type":"text","value":"1"}\n```\n', 'n.md');
    expect(blocks.map((b) => [b.kind, b.source.trim()])).toEqual([['output', '{"type":"text","value":"1"}']]);
    expect(markdown).toContain('print(1)');
  });
});
