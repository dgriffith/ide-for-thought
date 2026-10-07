/**
 * @vitest-environment happy-dom
 *
 * Reordering a Kanban board's columns and hiding empty ones (#2614), through
 * `TypeView`: the header menu's *Move column left / right* by keyboard (focus,
 * Escape, the live-region announcement), the order it writes, the board
 * drawing a `columnOrder`, the *Show empty columns* toggle, and a read-only
 * embed with neither. Pointer dragging is geometry, covered by
 * `kanban/column-drag.test.ts` and the e2e spec.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within } from '@testing-library/svelte';

const { instancesMock, listMock, noteTypeMapMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(), listMock: vi.fn(), noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
}));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';
import { getAnnouncerStore } from '../../../src/renderer/lib/stores/announcer.svelte';
import { reactiveProps } from '../../../src/renderer/lib/markdown/mounted-props.svelte';

const PROJECT = {
  id: 'project',
  label: 'Project',
  classLocalName: 'Project',
  icon: '🚀',
  source: 'stock' as const,
  properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'paused', 'done', 'abandoned'] }],
};
const row = (path: string, title: string, status: string | null) => ({ path, title, values: { status }, cover: null });
const INSTANCES = [row('a.md', 'Alpha', 'active'), row('b.md', 'Bravo', 'done'), row('d.md', 'Delta', 'paused')];

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'project',
    layout: 'kanban' as const,
    sortColumn: null,
    sortDir: 'asc' as const,
    columns: null,
    revision: 0,
    onStateChange: vi.fn(),
    onOpenNote: vi.fn(),
    ...over,
  };
}
const labels = (container: HTMLElement) => [...container.querySelectorAll('.kb-col-label')].map((l) => l.textContent);
const menuButton = (container: HTMLElement, value: string) =>
  container.querySelector<HTMLElement>(`.kb-column[data-column-value="${value}"] .kb-col-menu-btn`)!;

beforeEach(async () => {
  listMock.mockResolvedValue({ types: [PROJECT], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  await objectTypesStore.refresh();
  instancesMock.mockResolvedValue({ type: PROJECT, instances: INSTANCES });
});
afterEach(() => { cleanup(); instancesMock.mockReset(); });

describe('Kanban column order (#2614)', () => {
  it('draws the columns in the view\'s columnOrder, unlisted ones after in enum order', async () => {
    const { container } = render(TypeView, props({ columnOrder: ['done', 'abandoned'] }));
    await screen.findByText('Alpha');
    expect(labels(container)).toEqual(['done', 'abandoned', 'active', 'paused']);
  });

  it('each header has a menu button, reached by ↑ from the column\'s first card, and ←/→ walk the headers', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    const btn = menuButton(container, 'active');
    expect(btn.getAttribute('aria-label')).toBe('active column actions');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.tabIndex).toBe(-1); // the board stays one tab stop
    container.querySelector<HTMLElement>('[data-note-path="a.md"]')!.focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(btn);
    await fireEvent.keyDown(btn, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(menuButton(container, 'paused'));
    await fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(menuButton(container, 'abandoned')); // an empty column's header is reachable
    await fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(btn);
  });

  it('the menu opens on the button, focuses its first item, and Escape closes it with focus back on the button', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    const btn = menuButton(container, 'done');
    await fireEvent.click(btn);
    const menu = await screen.findByRole('menu', { name: 'done column' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Move column left', 'Move column right']);
    await vi.waitFor(() => expect(document.activeElement).toBe(items[0]));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('Move column left / right write the new order, and the moved column is announced and keeps focus', async () => {
    // A host that lands each patch on the tab, as the editor store does: on
    // fine-grained reactive props (testing-library's `rerender` replaces the
    // whole props object, which reloads the view and re-creates the board).
    const onStateChange = vi.fn((patch: Record<string, unknown>) => { Object.assign(host, patch); });
    const host: Record<string, unknown> = reactiveProps(props({ onStateChange }));
    const { container } = render(TypeView, { props: host as ReturnType<typeof props> });
    await screen.findByText('Alpha');

    await fireEvent.click(menuButton(container, 'done'));
    await fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move column left' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ columnOrder: ['active', 'done', 'paused', 'abandoned'] });
    await vi.waitFor(() => expect(labels(container)).toEqual(['active', 'done', 'paused', 'abandoned']));
    await vi.waitFor(() => expect(getAnnouncerStore().polite.trim()).toBe('Moved done column to position 2 of 4'));
    expect(document.activeElement).toBe(menuButton(container, 'done'));

    await fireEvent.click(menuButton(container, 'done'));
    await fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move column right' }));
    // Back to the enum's own order: no order at all.
    expect(onStateChange).toHaveBeenLastCalledWith({ columnOrder: [] });
    await vi.waitFor(() => expect(labels(container)).toEqual(['active', 'paused', 'done', 'abandoned']));
    await vi.waitFor(() => expect(getAnnouncerStore().polite.trim()).toBe('Moved done column to position 3 of 4'));
  });

  it('at the board\'s edge the move is offered but disabled, and does nothing', async () => {
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ onStateChange }));
    await screen.findByText('Alpha');
    await fireEvent.click(menuButton(container, 'active'));
    const left = within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move column left' });
    expect(left.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(left);
    expect(onStateChange).not.toHaveBeenCalled();
  });

  it('a right-click on a header opens the same menu', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    await fireEvent.contextMenu(container.querySelector('.kb-column[data-column-value="paused"] .kb-col-header')!);
    expect(await screen.findByRole('menu', { name: 'paused column' })).toBeTruthy();
  });

  it('a move skips a column hidden by Show empty columns, which keeps its place', async () => {
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ onStateChange, showEmptyColumns: false }));
    await screen.findByText('Alpha');
    expect(labels(container)).toEqual(['active', 'paused', 'done']);
    await fireEvent.click(menuButton(container, 'done'));
    await fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move column right' }));
    expect(onStateChange).not.toHaveBeenCalled(); // done is the last visible column
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  });
});

describe('Show empty columns (#2614)', () => {
  it('is on by default, beside the board\'s controls, and turning it off goes through onStateChange', async () => {
    const onStateChange = vi.fn();
    const { container, rerender } = render(TypeView, props({ onStateChange }));
    await screen.findByText('Alpha');
    const toggle = screen.getByRole('checkbox', { name: 'Show empty columns' });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(labels(container)).toContain('abandoned');

    await fireEvent.click(toggle);
    expect(onStateChange).toHaveBeenCalledWith({ showEmptyColumns: false });
    await rerender(props({ onStateChange, showEmptyColumns: false }));
    await vi.waitFor(() => expect(labels(container)).toEqual(['active', 'paused', 'done']));
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Show empty columns' }).checked).toBe(false);
  });

  it('is only on a board', async () => {
    render(TypeView, props({ layout: 'table' }));
    await screen.findByText('Alpha');
    expect(screen.queryByRole('checkbox', { name: 'Show empty columns' })).toBeNull();
  });

  it('Copy as markdown carries both fields, and omits them at their defaults', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { unmount } = render(TypeView, props({ columnOrder: ['done', 'active'], showEmptyColumns: false }));
    await screen.findByText('Alpha');
    await fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain('"columnOrder": [\n    "done",\n    "active"\n  ]');
    expect(writeText.mock.calls[0]![0]).toContain('"showEmptyColumns": false');
    unmount();

    render(TypeView, props());
    await screen.findByText('Alpha');
    await fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]![0]).not.toMatch(/columnOrder|showEmptyColumns/);
  });
});

describe('a read-only board (an embed)', () => {
  it('honours the order and the toggle, with no menu and no dragging', async () => {
    const { container } = render(TypeView, props({ chromeless: true, columnOrder: ['paused'], showEmptyColumns: false }));
    await screen.findByText('Alpha');
    expect(labels(container)).toEqual(['paused', 'active', 'done']);
    expect(container.querySelector('.kb-col-menu-btn')).toBeNull();
    expect(container.querySelector('[data-draggable]')).toBeNull();
  });
});
