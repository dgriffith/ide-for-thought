/**
 * @vitest-environment happy-dom
 *
 * An argument map rendered for export (#2514): the preview's own ArgumentMap,
 * resolved with the preview's wiki-link index, without its interactive
 * controls, its node links resolvable, and its diagram drawn by the export
 * mermaid path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FOCUS_URI = 'https://minerva.dev/notes/claim';
const GROUNDS_URI = 'https://minerva.dev/notes/grounds';
const REBUTTAL_URI = 'https://minerva.dev/notes/rebuttal';

const h = vi.hoisted(() => ({ query: vi.fn(), aliasEntries: vi.fn(), mermaidRender: vi.fn(), mermaidInit: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { graph: { query: h.query, aliasEntries: h.aliasEntries } } }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => ({ files: [
    { name: 'claim.md', relativePath: 'notes/claim.md', isDirectory: false },
    { name: 'grounds.md', relativePath: 'notes/grounds.md', isDirectory: false },
  ] }),
}));
vi.mock('mermaid', () => ({ default: { initialize: h.mermaidInit, render: h.mermaidRender } }));

import { renderArgumentMapForExport, parseArgumentDirectiveSource } from '../../../src/renderer/lib/export/render-argument-map';
import { renderLiveBlock } from '../../../src/renderer/lib/app/export-live-blocks';

const ok = (results: unknown[]) => ({ ok: true, results, columns: [] });

beforeEach(() => {
  h.aliasEntries.mockResolvedValue([{ alias: 'The Claim', relativePath: 'notes/claim.md' }]);
  h.mermaidRender.mockImplementation(async (id: string) => ({ svg: `<svg id="${id}"><text>diagram</text></svg>` }));
  h.query.mockImplementation((sparql: string) => {
    if (sparql.includes('minerva:relativePath') && sparql.includes('?focus')) return Promise.resolve(ok([{ focus: FOCUS_URI, title: 'The Claim' }]));
    if (sparql.includes('thought:defectIn')) return Promise.resolve(ok([]));
    if (sparql.includes(`<${FOCUS_URI}>`)) {
      return Promise.resolve(ok([
        { node: GROUNDS_URI, relation: 'https://minerva.dev/ontology/thought#supports', target: FOCUS_URI, title: 'Cited data', notePath: 'notes/grounds.md' },
        { node: REBUTTAL_URI, relation: 'https://minerva.dev/ontology/thought#rebuts', target: FOCUS_URI, title: 'Counterexample' },
      ]));
    }
    return Promise.resolve(ok([]));
  });
});
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('parseArgumentDirectiveSource', () => {
  it('reads the focus link and config, and rejects anything else', () => {
    expect(parseArgumentDirectiveSource(':::argument\ndepth: 2\nview: diagram\n---\n[[Claim]]\n:::')).toEqual({ focusRef: '[[Claim]]', config: { depth: '2', view: 'diagram' } });
    expect(parseArgumentDirectiveSource(':::argument\n[[Claim]]\n:::')).toEqual({ focusRef: '[[Claim]]', config: {} });
    expect(parseArgumentDirectiveSource('not one')).toBeNull();
  });
});

describe('renderArgumentMapForExport', () => {
  it('outline: the preview\'s grouping, node links resolvable, controls gone', async () => {
    const html = await renderArgumentMapForExport(':::argument\n[[The Claim]]\n:::');
    expect(html).toContain('class="minerva-live-block"');
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('The Claim'); // resolved through the alias, as the preview resolves it
    expect(html).toContain('data-note-link="notes/grounds.md">Cited data</a>');
    expect(html).toContain('Counterexample');
    expect(html).not.toContain('argument-map-controls');
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('Loading argument structure');
  });

  it('diagram: drawn by the export mermaid path, not the preview\'s hydration', async () => {
    const html = await renderArgumentMapForExport(':::argument\nview: diagram\n---\n[[notes/claim]]\n:::');
    expect(h.mermaidRender).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-export-/), expect.stringContaining('graph'));
    expect(html).toMatch(/<svg id="mermaid-export-[a-z0-9]+"><text>diagram<\/text><\/svg>/);
  });

  it('an unresolvable focus shows the preview\'s own message', async () => {
    const html = await renderArgumentMapForExport(':::argument\n[[Nowhere]]\n:::');
    expect(html).toContain("Can't find a note for");
    expect(h.query).not.toHaveBeenCalled();
  });

  it('is dispatched for the argument kind, and leaves nothing behind', async () => {
    const r = await renderLiveBlock({ id: 'B0', kind: 'argument', source: ':::argument\n[[The Claim]]\n:::', notePath: 'n.md' });
    expect(r.ok).toBe(true);
    expect(document.body.children).toHaveLength(0);
  });
});
