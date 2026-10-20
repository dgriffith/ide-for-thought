/**
 * @vitest-environment jsdom
 *
 * The View API's host (#2828): a type view becomes the plugin's `view`
 * event, its notes the session's scope; the plugin's `view.setState` comes
 * back as the layout's own spec fields only, and not at all when read-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  host: null as null | { setViewState?(p: Record<string, unknown>): void },
  sendView: vi.fn(async () => {}),
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: h.connect }));

import PluginLayout from '../../../src/renderer/lib/components/plugins/PluginLayout.svelte';
import type { LayoutView } from '../../../src/renderer/lib/components/type-view/layout-view';

function fakeView(over: Partial<LayoutView> = {}): LayoutView {
  const rows = [
    { path: 'a.md', title: 'Alpha', values: { status: 'todo' }, cover: null, tags: ['x'] },
    { path: 'b.md', title: 'Bravo', values: { status: 'done' }, cover: null },
  ];
  return {
    type: { id: 'task', label: 'Task', classLocalName: 'Task', properties: [], icon: '✅' },
    properties: [{ name: 'status', type: 'enum', options: ['todo', 'done'] }],
    visible: null, instances: rows, sorted: [rows[1]!, rows[0]!], sortColumn: 'title', sortDir: 'desc',
    readOnly: false, exportMode: false, onStateChange: vi.fn(),
    ...over,
  } as unknown as LayoutView;
}

beforeEach(() => {
  h.sendView.mockClear();
  h.connect.mockReset();
  h.connect.mockImplementation(async (_f: unknown, _id: string, _s: string[], host: typeof h.host) => {
    h.host = host;
    return { sessionId: 's', setScope: vi.fn(async () => {}), sendTheme: vi.fn(async () => {}), drop: vi.fn(), sendView: h.sendView, close: vi.fn(async () => {}) };
  });
});
afterEach(() => cleanup());

async function mounted(view = fakeView()) {
  const r = render(PluginLayout, { view, layout: 'kanban', pluginId: 'kanban', spec: { groupBy: 'status', columnOrder: [] } });
  await fireEvent.load(r.container.querySelector('iframe')!);
  await waitFor(() => expect(h.sendView).toHaveBeenCalled());
  return { ...r, view };
}

describe('PluginLayout (#2828)', () => {
  it("names the frame after the layout and type, and scopes it to the view's notes in its order", async () => {
    const { container } = await mounted();
    expect(container.querySelector('iframe')!.getAttribute('title')).toBe('Kanban of Task');
    expect(h.connect).toHaveBeenCalledWith(expect.anything(), 'kanban', ['b.md', 'a.md'], expect.anything());
  });

  it('sends the view as plain data', async () => {
    await mounted();
    expect(h.sendView.mock.calls.at(-1)![0]).toEqual({
      layout: 'kanban',
      type: { id: 'task', label: 'Task', icon: '✅' },
      properties: [{ name: 'status', type: 'enum', options: ['todo', 'done'] }],
      visible: null,
      instances: [
        { path: 'b.md', title: 'Bravo', values: { status: 'done' } },
        { path: 'a.md', title: 'Alpha', values: { status: 'todo' }, tags: ['x'] },
      ],
      sortColumn: 'title', sortDir: 'desc',
      spec: { groupBy: 'status', columnOrder: [] },
      readOnly: false, exportMode: false,
    });
  });

  it('sends it again when the view changes', async () => {
    const r = await mounted();
    const calls = h.sendView.mock.calls.length;
    await r.rerender({ view: fakeView({ sortDir: 'asc' }), layout: 'kanban', pluginId: 'kanban', spec: { groupBy: 'status', columnOrder: ['done'] } });
    await waitFor(() => expect(h.sendView.mock.calls.length).toBeGreaterThan(calls));
    expect(h.sendView.mock.calls.at(-1)![0]).toMatchObject({ sortDir: 'asc', spec: { columnOrder: ['done'] } });
  });

  it("keeps only the layout's own spec fields from view.setState", async () => {
    const { view } = await mounted();
    h.host!.setViewState!({ columnOrder: ['done', 'todo'], layout: 'table', folder: '/', filters: [] });
    expect(view.onStateChange).toHaveBeenCalledTimes(1);
    expect(view.onStateChange).toHaveBeenCalledWith({ columnOrder: ['done', 'todo'] });
    h.host!.setViewState!({ layout: 'table' });
    expect(view.onStateChange).toHaveBeenCalledTimes(1);
  });

  it('changes nothing in an embed or export', async () => {
    const { view } = await mounted(fakeView({ readOnly: true }));
    h.host!.setViewState!({ columnOrder: ['done'] });
    expect(view.onStateChange).not.toHaveBeenCalled();
  });
});
