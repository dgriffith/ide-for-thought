/**
 * @vitest-environment jsdom
 *
 * Kanban column order and Show empty columns (#2614), the host's half: the
 * order the view sends the plugin, the new order a plugin's
 * `view.moveColumn` writes, the toggle, Copy as markdown, and an embed.
 * The header menu and its keyboard are the board's
 * (tests/plugins/kanban/Board.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/svelte';
import { kanbanHostState, openBoard } from './kanban-host';

const { instancesMock, listMock, noteTypeMapMock, plugin } = vi.hoisted(() => ({
  instancesMock: vi.fn(), listMock: vi.fn(), noteTypeMapMock: vi.fn(),
  plugin: {} as import('./kanban-host').KanbanHostState,
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: (...a: unknown[]) => plugin.connect(...a) }));
vi.mock('../../../src/renderer/lib/stores/code-plugins.svelte', () => ({ codePluginsStore: { isOn: () => true, name: () => 'Kanban' } }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const PROJECT = {
  id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock' as const,
  properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'paused', 'done', 'abandoned'] }],
};
const row = (path: string, title: string, status: string | null) => ({ path, title, values: { status }, cover: null });
const INSTANCES = [row('a.md', 'Alpha', 'active'), row('b.md', 'Bravo', 'done'), row('d.md', 'Delta', 'paused')];

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'project', layout: 'kanban' as const, sortColumn: null, sortDir: 'asc' as const, columns: null,
    revision: 0, onStateChange: vi.fn(), onOpenNote: vi.fn(), ...over,
  };
}

beforeEach(async () => {
  kanbanHostState(plugin);
  listMock.mockResolvedValue({ types: [PROJECT], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  await objectTypesStore.refresh();
  instancesMock.mockResolvedValue({ type: PROJECT, instances: INSTANCES });
});
afterEach(() => { cleanup(); instancesMock.mockReset(); });

const labels = (b: Awaited<ReturnType<typeof openBoard>>) => b.columns().map(([l]) => l);

describe('Kanban column order (#2614)', () => {
  it("sends the columns in the view's columnOrder, unlisted ones after in enum order", async () => {
    const { container } = render(TypeView, props({ columnOrder: ['done', 'abandoned'] }));
    expect(labels(await openBoard(container, plugin))).toEqual(['done', 'abandoned', 'active', 'paused']);
  });

  it("a plugin's view.moveColumn writes the new order — and back to the enum's order is no order at all", async () => {
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ onStateChange }));
    const b = await openBoard(container, plugin);
    b.host().moveColumn!('done', 'active', 'before');
    expect(onStateChange).toHaveBeenLastCalledWith({ columnOrder: ['done', 'active', 'paused', 'abandoned'] });
    // done to just after paused: its own place in the enum, so no order at all.
    b.host().moveColumn!('done', 'paused', 'after');
    expect(onStateChange).toHaveBeenLastCalledWith({ columnOrder: [] });
  });

  it('an embed does not move columns', async () => {
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ onStateChange, chromeless: true }));
    const b = await openBoard(container, plugin);
    b.host().moveColumn!('done', 'active', 'before');
    expect(onStateChange).not.toHaveBeenCalled();
  });
});

describe('Show empty columns (#2614)', () => {
  it("is on by default, beside the board's controls, and turning it off goes through onStateChange", async () => {
    const onStateChange = vi.fn();
    const { container, rerender } = render(TypeView, props({ onStateChange }));
    const b = await openBoard(container, plugin);
    const toggle = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Show empty columns' });
    expect(toggle.checked).toBe(true);
    expect(labels(b)).toContain('abandoned');
    await fireEvent.click(toggle);
    expect(onStateChange).toHaveBeenCalledWith({ showEmptyColumns: false });
    await rerender(props({ onStateChange, showEmptyColumns: false }));
    await vi.waitFor(() => expect(labels(b)).toEqual(['active', 'paused', 'done']));
    expect(b.state().spec).toMatchObject({ showEmptyColumns: false });
  });

  it('is only on a board', async () => {
    render(TypeView, props({ layout: 'table' }));
    await screen.findByText('Alpha');
    expect(screen.queryByRole('checkbox', { name: 'Show empty columns' })).toBeNull();
  });

  it('Copy as markdown carries both fields, and omits them at their defaults', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const first = render(TypeView, props({ columnOrder: ['done', 'active'], showEmptyColumns: false }));
    await openBoard(first.container, plugin);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain('"columnOrder": [\n    "done",\n    "active"\n  ]');
    expect(writeText.mock.calls[0]![0]).toContain('"showEmptyColumns": false');
    first.unmount();

    kanbanHostState(plugin);
    const second = render(TypeView, props());
    await openBoard(second.container, plugin);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]![0]).not.toMatch(/columnOrder|showEmptyColumns/);
  });
});

describe('Copy as markdown carries the grouping (#2601)', () => {
  const TASK = {
    id: 'task', label: 'Task', classLocalName: 'Task', source: 'stock' as const,
    properties: [
      { name: 'status', type: 'enum' as const, options: ['todo', 'done'] },
      { name: 'priority', type: 'enum' as const, options: ['low', 'high'] },
      { name: 'owner', type: 'text' as const },
    ],
  };
  /** The spec in the copied ```object-view fence. */
  const copiedSpec = (md: string) => JSON.parse(/```object-view\n([\s\S]*?)\n```/.exec(md)![1]!) as Record<string, unknown>;

  it('copies groupBy when it is an enum of the type, and drops one that is not', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    listMock.mockResolvedValue({ types: [TASK], errors: [] });
    await objectTypesStore.refresh();
    instancesMock.mockResolvedValue({ type: TASK, instances: [{ path: 't.md', title: 'Write spec', values: { status: 'todo', priority: 'high', owner: 'Ann' }, cover: null }] });

    const first = render(TypeView, props({ typeId: 'task', groupBy: 'priority' }));
    await openBoard(first.container, plugin);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(copiedSpec(writeText.mock.calls[0]![0] as string)).toMatchObject({ typeId: 'task', layout: 'kanban', groupBy: 'priority' });
    first.unmount();

    // `owner` is a text property, so it can't group a board: left out, which
    // reads back as the default (the first enum).
    kanbanHostState(plugin);
    const second = render(TypeView, props({ typeId: 'task', groupBy: 'owner' }));
    await openBoard(second.container, plugin);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]![0] as string).not.toContain('groupBy');
  });
});

describe('a read-only board (an embed)', () => {
  it('honours the order and the toggle, and is read-only', async () => {
    const { container } = render(TypeView, props({ chromeless: true, columnOrder: ['paused'], showEmptyColumns: false }));
    const b = await openBoard(container, plugin);
    expect(labels(b)).toEqual(['paused', 'active', 'done']);
    expect(b.state().readOnly).toBe(true);
  });
});
