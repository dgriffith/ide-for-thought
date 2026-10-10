/**
 * @vitest-environment happy-dom
 *
 * An object view's `width` (#2709) in an export: drawn at that width, and
 * framed so a page shows it as the preview does — at most the printable width
 * when the export is paged (PDF).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ widths: [] as string[] }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    types: {
      instances: vi.fn(async () => ({ type: { id: 'place', label: 'Place', classLocalName: 'Place', source: 'user', properties: [] }, instances: [] })),
      list: vi.fn(async () => ({ types: [], errors: [] })),
      noteTypeMap: vi.fn(async () => ({})),
    },
    app: { getSystemLocale: async () => 'en-GB' },
  },
}));
// The width the off-screen host was laid out at is what the view is drawn to.
vi.mock('../../../src/renderer/lib/export/live-block-snapshot', () => ({
  snapshotLiveBlock: (themed: HTMLElement) => {
    h.widths.push(themed.parentElement!.style.width);
    return '<div class="minerva-live-block">VIEW</div>';
  },
}));

import { EXPORT_BLOCK_WIDTH_PX, frameForWidth, renderObjectViewForExport } from '../../../src/renderer/lib/export/render-object-view';
import { renderLiveBlock } from '../../../src/renderer/lib/app/export-live-blocks';

const spec = (extra: Record<string, unknown> = {}) => JSON.stringify({ typeId: 'place', layout: 'list', ...extra });

beforeEach(() => { h.widths = []; });

describe('renderObjectViewForExport — width (#2709)', () => {
  it('without a width: drawn at the export block width, unframed', async () => {
    const html = await renderObjectViewForExport(spec());
    expect(h.widths).toEqual([`${EXPORT_BLOCK_WIDTH_PX}px`]);
    expect(html).toBe('<div class="minerva-live-block">VIEW</div>');
  });

  it('wider, for a screen: drawn at its width, in a frame that breaks out', async () => {
    const html = await renderObjectViewForExport(spec({ width: 1400 }));
    expect(h.widths).toEqual(['1400px']);
    expect(html).toContain('class="minerva-live-frame" data-breakout="1"');
    expect(html).toContain('width:min(1400px, max(100%, calc((100cqw + 100%) / 2 - 32px)))');
    expect(html).toContain('<div class="minerva-live-block">VIEW</div>');
  });

  it('wider, for a page: drawn at the printable width, not breaking out', async () => {
    const html = await renderObjectViewForExport(spec({ width: 1400 }), { paged: true });
    expect(h.widths).toEqual([`${EXPORT_BLOCK_WIDTH_PX}px`]);
    expect(html).not.toContain('data-breakout');
    expect(html).toContain(`width:min(${EXPORT_BLOCK_WIDTH_PX}px, 100%)`);
  });

  it('narrower: drawn at its width on a screen and a page alike', async () => {
    await renderObjectViewForExport(spec({ width: 500 }));
    await renderObjectViewForExport(spec({ width: 500 }), { paged: true });
    expect(h.widths).toEqual(['500px', '500px']);
  });

  it('the window passes the request\'s paged flag through', async () => {
    const r = await renderLiveBlock({ id: 'B0', kind: 'object-view', source: spec({ width: 1400 }), notePath: 'n.md', paged: true });
    expect(r.ok).toBe(true);
    expect(h.widths).toEqual([`${EXPORT_BLOCK_WIDTH_PX}px`]);
  });
});

describe('frameForWidth', () => {
  it('scrolls the block, not the page, when the window is narrower than it', () => {
    expect(frameForWidth('<p>x</p>', 1200, { paged: false })).toContain('.minerva-live-frame{max-width:none;overflow-x:auto}');
  });
  it('marks a breakout only past the default block width', () => {
    expect(frameForWidth('', EXPORT_BLOCK_WIDTH_PX, { paged: false })).not.toContain('data-breakout');
    expect(frameForWidth('', EXPORT_BLOCK_WIDTH_PX + 1, { paged: false })).toContain('data-breakout');
  });
});
