/**
 * @vitest-environment jsdom
 *
 * A `:::mindmap` block (#2966): the preview's placeholder, the block drawing
 * the walk main returns (or the focus note's own outline), opening a node's
 * note, saying what's wrong when it can't draw, and the export's still SVG.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ mindmap: vi.fn(), readFile: vi.fn() }));
vi.mock('../../../../src/renderer/lib/ipc/client', () => ({ api: { graph: { mindmap: h.mindmap, aliasEntries: async () => [] }, notebase: { readFile: h.readFile } } }));
vi.mock('../../../../src/renderer/lib/export/wiki-resolver', () => ({ previewWikiResolver: async () => (t: string) => (t === 'Launch' ? 'Launch.md' : null) }));
import MindmapBlock from '../../../../src/renderer/lib/components/mindmap/MindmapBlock.svelte';
import { createPreviewMarkdown } from '../../../../src/renderer/lib/preview/markdown-config';
import { renderMindmapForExport } from '../../../../src/renderer/lib/export/render-mindmap';
import { parseMindmapBlock } from '../../../../src/shared/mindmap/note-hierarchy';

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
const WALK = { truncated: false, exists: true, tree: { id: 'Launch.md', label: 'Launch', path: 'Launch.md', children: [
  { id: 'b', label: 'Build', path: 'Build.md', children: [{ id: 'c', label: 'Code', path: 'Code.md', children: [], mark: 'shared', appearances: 2 }] },
  { id: 'm', label: 'Market', path: 'Market.md', children: [] },
] } };
beforeEach(() => { h.mindmap.mockReset().mockResolvedValue(WALK); h.readFile.mockReset(); });
afterEach(() => cleanup());

describe('the :::mindmap block (#2966)', () => {
  it('the preview turns the directive into a placeholder carrying its body', () => {
    const html = createPreviewMarkdown().render(':::mindmap\n[[Launch]]\nrelation: parent\n:::\n');
    expect(html).toMatch(/<div class="mindmap-block" data-spec="\[\[Launch\]\]\nrelation: parent">/);
  });

  it('draws main\'s walk along the relation, marks a note drawn twice, and opens a node\'s note', async () => {
    const onNavigate = vi.fn();
    const r = render(MindmapBlock, { spec: parseMindmapBlock('[[Launch]]\nrelation: parent\ndepth: 2'), focusPath: 'Launch.md', onNavigate });
    await waitFor(() => expect(r.container.querySelectorAll('[role="treeitem"]')).toHaveLength(4));
    expect(h.mindmap).toHaveBeenCalledWith('Launch.md', { relation: 'parent', direction: 'in', depth: 2 });
    expect([...r.container.querySelectorAll('[role="treeitem"]')].map((e) => e.getAttribute('aria-label'))).toEqual(['Launch', 'Build', 'Code (in 2 places)', 'Market']);
    await fireEvent.dblClick(r.container.querySelector('[aria-label="Market"]')!);
    expect(onNavigate).toHaveBeenCalledWith('Market.md');
  });

  it('headings: the focus note\'s own outline, read from the note', async () => {
    h.readFile.mockResolvedValue('# Plan\n## Pack\n- socks\n');
    const r = render(MindmapBlock, { spec: parseMindmapBlock('[[Launch]]'), focusPath: 'Launch.md', onNavigate: vi.fn() });
    await waitFor(() => expect([...r.container.querySelectorAll('[role="treeitem"]')].map((e) => e.getAttribute('aria-label'))).toEqual(['Launch', 'Plan', 'Pack', 'socks']));
    expect(h.mindmap).not.toHaveBeenCalled();
  });

  it('says what\'s wrong: no focus, a focus that names no note, nothing joined to it', async () => {
    const r1 = render(MindmapBlock, { spec: parseMindmapBlock('relation: parent'), focusPath: null, onNavigate: vi.fn() });
    expect(r1.container.textContent).toContain('needs a focus note');
    cleanup();
    const r2 = render(MindmapBlock, { spec: parseMindmapBlock('[[Nope]]\nrelation: parent'), focusPath: null, onNavigate: vi.fn() });
    expect(r2.container.textContent).toContain('No note is called “Nope”');
    cleanup();
    h.mindmap.mockResolvedValue({ truncated: false, exists: true, tree: { id: 'x', label: 'Launch', path: 'Launch.md', children: [] } });
    const r3 = render(MindmapBlock, { spec: parseMindmapBlock('[[Launch]]\nrelation: parent'), focusPath: 'Launch.md', onNavigate: vi.fn() });
    await waitFor(() => expect(r3.container.textContent).toContain('Nothing is joined to “Launch” by “parent”'));
  });

  it('exports as a still SVG of every node, in the export\'s colours', async () => {
    const html = await renderMindmapForExport(':::mindmap\n[[Launch]]\nrelation: parent\nlayout: radial\n:::\n');
    expect(html).toMatch(/^<figure class="mindmap-export"><svg style="max-width: 100%; height: auto;"/);
    for (const label of ['Launch', 'Build', 'Code (in 2 places)', 'Market']) expect(html).toContain(`>${label}</tspan>`);
    expect(await renderMindmapForExport(':::mindmap\n[[Elsewhere]]\n:::\n')).toContain('No note is called “Elsewhere”');
  });
});
