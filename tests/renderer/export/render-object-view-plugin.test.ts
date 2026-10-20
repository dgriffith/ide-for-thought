/**
 * @vitest-environment happy-dom
 *
 * Exporting a layout a plugin draws (#2828): the snapshot waits for the
 * plugin's sanitized markup to be drawn in the frame's place, and a plugin
 * that never answers fails the block instead of exporting an empty frame.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../src/renderer/lib/components/TypeView.svelte', async () => ({
  default: (await import('./fixtures/FakePluginTypeView.svelte')).default,
}));

import { renderObjectViewForExport, OBJECT_VIEW_LOAD_TIMEOUT_MS } from '../../../src/renderer/lib/export/render-object-view';

const SOURCE = JSON.stringify({ typeId: 'task', layout: 'kanban' });
const g = globalThis as { __fakeDrawAfterMs?: number | null; __fakeFail?: string };

afterEach(() => { delete g.__fakeDrawAfterMs; delete g.__fakeFail; vi.useRealTimers(); });

describe('a plugin-drawn layout in an export (#2828)', () => {
  it('is snapshotted once the plugin has drawn, not before', async () => {
    g.__fakeDrawAfterMs = 30;
    const html = await renderObjectViewForExport(SOURCE);
    expect(html).toContain('The board, drawn.');
    expect(html).not.toContain('frame-stand-in');
  });

  it('fails the block, saying why, when the plugin view reports it could not draw', async () => {
    g.__fakeFail = 'the session was refused';
    await expect(renderObjectViewForExport(SOURCE)).rejects.toThrow("the plugin view couldn't be drawn: the session was refused");
  });

  it('fails the block when the plugin never answers', async () => {
    vi.useFakeTimers();
    g.__fakeDrawAfterMs = null;
    const pending = renderObjectViewForExport(SOURCE);
    const settled = expect(pending).rejects.toThrow('the plugin view took too long to draw');
    await vi.advanceTimersByTimeAsync(OBJECT_VIEW_LOAD_TIMEOUT_MS + 100);
    await settled;
  });
});
