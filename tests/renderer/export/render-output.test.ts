/**
 * @vitest-environment happy-dom
 *
 * A saved compute-cell output rendered for export (#2515): the preview's own
 * renderComputeOutput, without its save-as-note menu.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderOutputForExport } from '../../../src/renderer/lib/export/render-output';
import { renderLiveBlock } from '../../../src/renderer/lib/app/export-live-blocks';

afterEach(() => { document.body.innerHTML = ''; });

describe('renderOutputForExport', () => {
  it('a table renders as the preview\'s table, with no ⋯ menu', () => {
    const html = renderOutputForExport(JSON.stringify({ type: 'table', columns: ['city', 'visits'], rows: [['Prague', 3], ['Budapest', 5]] }));
    expect(html).toContain('class="minerva-live-block"');
    expect(html).toContain('<th>city</th>');
    expect(html).toContain('<td>Budapest</td>');
    expect(html).not.toContain('compute-output-menu-btn');
  });

  it('text, an image and an error as the preview shows them', () => {
    expect(renderOutputForExport(JSON.stringify({ type: 'text', value: 'hello' }))).toContain('compute-output-text');
    expect(renderOutputForExport(JSON.stringify({ type: 'image', mime: 'image/png', data: 'AAAA' }))).toContain('src="data:image/png;base64,AAAA"');
    expect(renderOutputForExport(JSON.stringify({ type: 'error', message: 'NameError: x' }))).toContain('NameError: x');
  });

  it('raw text that isn\'t a payload still renders, as the preview does', () => {
    expect(renderOutputForExport('just text')).toContain('compute-output-raw');
  });

  it('is dispatched for the output kind, and leaves nothing behind', async () => {
    const r = await renderLiveBlock({ id: 'B0', kind: 'output', source: '{"type":"text","value":"1"}', notePath: 'n.md' });
    expect(r.ok).toBe(true);
    expect(document.body.children).toHaveLength(0);
  });
});
