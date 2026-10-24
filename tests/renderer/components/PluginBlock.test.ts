/**
 * @vitest-environment jsdom
 *
 * A plugin's live block (#2641): its frame connects as the block — main
 * decides its notes — and asks for the block again on every graph change;
 * it is as tall as the plugin asks; and for an export it sends the block,
 * then the export request, and draws the plugin's answer sanitized in the
 * frame's place.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  order: [] as string[],
  host: null as null | { setHeight?(h: number): void; exportHtml?(id: string, html: string): void },
  graphChanged: null as null | (() => void),
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: h.connect }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { onChanged: (fn: () => void) => { h.graphChanged = fn; return () => {}; } } },
}));

import PluginBlock from '../../../src/renderer/lib/components/plugins/PluginBlock.svelte';

const PROPS = { pluginId: 'reading-queue', blockId: 'queue', entry: 'index.html', title: 'Reading queue', notePath: 'n.md', source: 'limit: 2\n' };
let lastRequestId = '';

beforeEach(() => {
  h.order = [];
  h.connect.mockReset();
  h.connect.mockImplementation(async (_f: unknown, _id: string, _scope: string[], host: typeof h.host) => {
    h.host = host;
    return {
      sessionId: 's1', setScope: vi.fn(), sendTheme: vi.fn(async () => {}), sendPreview: vi.fn(async () => {}),
      refreshQuery: vi.fn(async () => { h.order.push('refresh'); }),
      requestExport: vi.fn(async (id: string) => { lastRequestId = id; h.order.push('export'); }),
      close: vi.fn(async () => {}),
    };
  });
});
afterEach(() => cleanup());

async function connected(props: Record<string, unknown> = {}) {
  const r = render(PluginBlock, { ...PROPS, ...props });
  const frame = r.container.querySelector('iframe')!;
  await fireEvent.load(frame);
  await waitFor(() => expect(h.connect).toHaveBeenCalled());
  return { ...r, frame };
}

describe('PluginBlock (#2641)', () => {
  it('connects as the block, with its note and text and no scope of its own, and refreshes on connect and on graph change', async () => {
    const { frame } = await connected();
    expect(frame.getAttribute('src')).toBe('minerva-plugin://reading-queue/index.html');
    expect(frame.getAttribute('title')).toBe('Reading queue');
    expect(h.connect).toHaveBeenCalledWith(frame, 'reading-queue', [], expect.any(Object), { block: 'queue', notePath: 'n.md', source: 'limit: 2\n', exportMode: false });
    await waitFor(() => expect(h.order).toEqual(['refresh']));
    h.graphChanged!();
    await waitFor(() => expect(h.order).toEqual(['refresh', 'refresh']));
  });

  it('is as tall as the plugin asks', async () => {
    const { container } = await connected();
    const box = container.querySelector<HTMLElement>('.plugin-block-frame')!;
    expect(box.style.height).toBe('120px');
    h.host!.setHeight!(240);
    await waitFor(() => expect(box.style.height).toBe('240px'));
  });

  it('for an export: the block, then the request, then the answer drawn sanitized in the frame’s place', async () => {
    const onRendered = vi.fn();
    const { container } = await connected({ exportMode: true, onExport: { onRendered, onFailed: vi.fn() } });
    await waitFor(() => expect(h.order).toEqual(['refresh', 'export']));
    h.graphChanged!(); // an export doesn't follow the graph
    h.host!.exportHtml!('not-ours', '<p>wrong</p>');
    h.host!.exportHtml!(lastRequestId, '<ul><li><span data-note-path="b.md">Walden</span><script>x()</script><img src="https://x.test/b.png"></li></ul>');
    await waitFor(() => expect(onRendered).toHaveBeenCalledTimes(1));
    const drawn = container.querySelector<HTMLElement>('.plugin-export')!;
    expect(drawn.innerHTML).toBe('<ul><li><span data-note-path="b.md">Walden</span></li></ul>');
    expect(container.querySelector('iframe')).toBeNull();
    expect(h.order).toEqual(['refresh', 'export']);
  });

  it('says why when an export can’t be asked for', async () => {
    h.connect.mockImplementation(async () => ({
      sessionId: 's', sendTheme: vi.fn(async () => {}), close: vi.fn(async () => {}),
      refreshQuery: vi.fn(async () => { throw new Error('the session ended'); }), requestExport: vi.fn(),
    }));
    const onFailed = vi.fn();
    await connected({ exportMode: true, onExport: { onRendered: vi.fn(), onFailed } });
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('the session ended'));
  });
});
