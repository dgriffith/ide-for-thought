/**
 * @vitest-environment happy-dom
 *
 * A mermaid diagram rendered for export (#2513): the preview's own mermaid
 * setup, themed from the light host, measured in the export page's font, with
 * a unique id per diagram — and the preview's theme left to re-initialize.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: { initialize: h.initialize, render: h.render } }));

import { renderMermaidForExport, EXPORT_DIAGRAM_FONT } from '../../../src/renderer/lib/export/render-mermaid';
import { renderLiveBlock } from '../../../src/renderer/lib/app/export-live-blocks';

beforeEach(() => {
  h.initialize.mockReset();
  h.render.mockReset().mockImplementation(async (id: string) => ({ svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg"><g><text>Write</text></g></svg>` }));
});
afterEach(() => { document.body.innerHTML = ''; });

describe('renderMermaidForExport', () => {
  it('renders inline SVG in the preview\'s container, light-themed', async () => {
    const html = await renderMermaidForExport('graph TD; A-->B');
    expect(h.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-export-/), 'graph TD; A-->B');
    expect(html).toContain('class="minerva-live-block"');
    expect(html).toContain('data-theme="light"');
    expect(html).toMatch(/<div class="mermaid-block" data-mermaid-rendered="ok"><svg id="mermaid-export-[a-z0-9]+"/);
    expect(html).toContain('<text>Write</text>');
  });

  it('initializes the preview\'s base theme with the export page\'s font', async () => {
    await renderMermaidForExport('graph TD; A-->B');
    expect(h.initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict', theme: 'base', themeVariables: expect.objectContaining({ fontFamily: EXPORT_DIAGRAM_FONT }),
    }));
  });

  it('gives every diagram its own id, so their #id-scoped styles can\'t collide', async () => {
    await renderMermaidForExport('graph TD; A-->B');
    await renderMermaidForExport('graph TD; C-->D');
    const [a, b] = h.render.mock.calls.map((c) => c[0] as string);
    expect(a).not.toBe(b);
  });

  it('re-initializes for every export render, so a preview theme never leaks in (and vice versa)', async () => {
    await renderMermaidForExport('graph TD; A-->B');
    await renderMermaidForExport('graph TD; C-->D');
    expect(h.initialize).toHaveBeenCalledTimes(2);
  });

  it('a diagram that doesn\'t parse shows the preview\'s error box', async () => {
    h.render.mockRejectedValue(new Error('Parse error on line 1: graph TD; A--'));
    const html = await renderMermaidForExport('graph TD; A--');
    expect(html).toContain('data-mermaid-rendered="error"');
    expect(html).toContain('<strong>Mermaid error</strong>');
    expect(html).toContain('Parse error on line 1');
    expect(document.body.children).toHaveLength(0);
  });

  it('is dispatched for the mermaid kind', async () => {
    const r = await renderLiveBlock({ id: 'B0', kind: 'mermaid', source: 'graph TD; A-->B', notePath: 'n.md' });
    expect(r.ok).toBe(true);
  });
});
