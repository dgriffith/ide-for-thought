/**
 * @vitest-environment happy-dom
 *
 * Moving a Kanban card (#2603), board side: *Move to ▸* in the card's menu
 * (right-click, or Shift+F10 from the keyboard), pointer drag onto a column,
 * ⌘Z, and an embed that moves nothing. The write is the `kanban-moves`
 * store's — mocked here; its own test covers it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  instances: vi.fn(), list: vi.fn(), noteTypeMap: vi.fn(),
  moveCards: vi.fn(), undoLastMove: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: h.instances, list: h.list, noteTypeMap: h.noteTypeMap } },
}));
vi.mock('../../../src/renderer/lib/stores/kanban-moves.svelte', () => ({
  getKanbanMoveStore: () => ({ revision: 0, lastMove: null, canUndo: true, moveCards: h.moveCards, undoLastMove: h.undoLastMove }),
}));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const PROJECT = {
  id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock' as const,
  properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'paused', 'done', 'abandoned'] }],
};
const row = (path: string, title: string, status: string | null) => ({ path, title, values: { status }, cover: null });
const ROWS = [row('a.md', 'Alpha', 'active'), row('c.md', 'Charlie', 'active'), row('b.md', 'Bravo', 'done')];

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'project', layout: 'kanban' as const, sortColumn: null, sortDir: 'asc' as const, columns: null,
    revision: 0, onStateChange: vi.fn(), onOpenNote: vi.fn(), onEditProperties: vi.fn(), ...over,
  };
}
const card = (c: HTMLElement, path: string) => c.querySelector<HTMLElement>(`[data-kanban-card][data-note-path="${path}"]`)!;
const column = (c: HTMLElement, value: string) => c.querySelector<HTMLElement>(`section.kb-column[data-column-value="${value}"]`)!;

beforeEach(async () => {
  h.list.mockResolvedValue({ types: [PROJECT], errors: [] });
  h.noteTypeMap.mockResolvedValue({});
  await objectTypesStore.refresh();
  h.instances.mockResolvedValue({ type: PROJECT, instances: ROWS });
  h.moveCards.mockResolvedValue([]);
  h.undoLastMove.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Kanban: Move to ▸ (#2603)', () => {
  it('the card menu lists every column plus No value; the current one is disabled; a pick moves the card', async () => {
    render(TypeView, props());
    await fireEvent.contextMenu(await screen.findByText('Alpha'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /Move to/ }));
    const sub = screen.getByRole('menu', { name: 'Move to' });
    const items = within(sub).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['active', 'paused', 'done', 'abandoned', 'No value']);
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(within(sub).getByRole('menuitem', { name: 'done' }));
    expect(h.moveCards).toHaveBeenCalledWith([{ path: 'a.md', title: 'Alpha' }], 'status', { value: 'done', label: 'done', kind: 'option' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves the whole selection, and No value clears the field', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    await fireEvent.click(card(container, 'a.md'), { metaKey: true });
    await fireEvent.click(card(container, 'b.md'), { metaKey: true });
    await fireEvent.contextMenu(card(container, 'b.md'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /Move to \(2 cards\)/ }));
    // Mixed columns: nothing is disabled.
    expect(within(screen.getByRole('menu', { name: 'Move to' })).getAllByRole('menuitem').every((i) => !(i as HTMLButtonElement).disabled)).toBe(true);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'No value' }));
    expect(h.moveCards).toHaveBeenCalledWith(
      [{ path: 'a.md', title: 'Alpha' }, { path: 'b.md', title: 'Bravo' }], 'status', { value: null, label: 'No value', kind: 'no-value' },
    );
  });

  it('keyboard only: Shift+F10 opens the menu in focus, → opens Move to, Enter picks', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    card(container, 'a.md').focus();
    await fireEvent.keyDown(card(container, 'a.md'), { key: 'F10', shiftKey: true });
    const move = screen.getByRole('menuitem', { name: /Move to/ });
    expect(document.activeElement).toBe(move);
    await fireEvent.keyDown(move, { key: 'ArrowRight' });
    expect(move.getAttribute('aria-expanded')).toBe('true');
    // The first enabled column (active is disabled — Alpha is in it).
    expect(document.activeElement?.textContent).toBe('paused');
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('done');
    await fireEvent.click(document.activeElement!); // Enter on a button is a click
    expect(h.moveCards).toHaveBeenCalledWith([{ path: 'a.md', title: 'Alpha' }], 'status', expect.objectContaining({ value: 'done' }));
  });

  it('Escape closes the menu and gives focus back to the card', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    card(container, 'a.md').focus();
    await fireEvent.keyDown(card(container, 'a.md'), { key: 'ContextMenu' });
    await fireEvent.keyDown(screen.getByRole('menuitem', { name: /Move to/ }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(card(container, 'a.md'));
  });

  it('⌘Z on the board undoes the last move', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    await fireEvent.keyDown(card(container, 'c.md'), { key: 'z', metaKey: true });
    expect(h.undoLastMove).toHaveBeenCalledOnce();
  });

  it('a list or table row menu has no Move to', async () => {
    render(TypeView, props({ layout: 'list' }));
    await fireEvent.contextMenu(await screen.findByText('Alpha'));
    expect(screen.getByRole('menuitem', { name: /Edit Properties/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Move to/ })).toBeNull();
  });
});

describe('Kanban: pointer drag (#2603)', () => {
  let hit: HTMLElement | null = null;
  const realElementFromPoint = document.elementFromPoint;
  beforeEach(() => { document.elementFromPoint = vi.fn(() => hit); });
  afterEach(() => { document.elementFromPoint = realElementFromPoint; hit = null; });

  async function drag(c: HTMLElement, from: HTMLElement, to: HTMLElement | null) {
    await fireEvent.pointerDown(from, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    hit = to;
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 12 });
    return {
      drop: async () => {
        await fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 12 });
        await fireEvent.click(from);
      },
      board: c.querySelector<HTMLElement>('.kb-board')!,
    };
  }

  it('dragging a card onto a column marks the target, then sets the property on drop — and doesn’t open the note', async () => {
    const onOpenNote = vi.fn();
    const { container } = render(TypeView, props({ onOpenNote }));
    await screen.findByText('Alpha');
    const done = column(container, 'done');
    const d = await drag(container, card(container, 'a.md'), done);
    expect(done.hasAttribute('data-drop-target')).toBe(true);
    expect(card(container, 'a.md').hasAttribute('data-dragging')).toBe(true);
    expect(document.querySelector('[data-kanban-ghost]')).not.toBeNull();

    await d.drop();
    expect(h.moveCards).toHaveBeenCalledWith([{ path: 'a.md', title: 'Alpha' }], 'status', { value: 'done', label: 'done', kind: 'option' });
    expect(onOpenNote).not.toHaveBeenCalled();
    expect(done.hasAttribute('data-drop-target')).toBe(false);
    expect(document.querySelector('[data-kanban-ghost]')).toBeNull();
  });

  it('dropping back on its own column, or outside the board, moves nothing', async () => {
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    const own = column(container, 'active');
    let d = await drag(container, card(container, 'a.md'), own);
    expect(own.hasAttribute('data-drop-target')).toBe(false);
    await d.drop();
    d = await drag(container, card(container, 'a.md'), null);
    await d.drop();
    expect(h.moveCards).not.toHaveBeenCalled();
  });

  it('a press without travel is a plain click (opens the note), and Escape cancels a drag', async () => {
    const onOpenNote = vi.fn();
    const { container } = render(TypeView, props({ onOpenNote }));
    await screen.findByText('Alpha');
    await fireEvent.pointerDown(card(container, 'a.md'), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 11, clientY: 10 });
    await fireEvent.click(card(container, 'a.md'));
    expect(onOpenNote).toHaveBeenCalledWith('a.md');

    await drag(container, card(container, 'c.md'), column(container, 'paused'));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(column(container, 'paused').hasAttribute('data-drop-target')).toBe(false);
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 12 });
    expect(h.moveCards).not.toHaveBeenCalled();
  });

  it('an embedded board (no host editor) neither drags nor offers Move to', async () => {
    const { container } = render(TypeView, props({ onEditProperties: undefined, chromeless: true }));
    await screen.findByText('Alpha');
    await drag(container, card(container, 'a.md'), column(container, 'done'));
    expect(column(container, 'done').hasAttribute('data-drop-target')).toBe(false);
    await fireEvent.contextMenu(card(container, 'a.md'));
    expect(screen.queryByRole('menu')).toBeNull();
    await fireEvent.keyDown(card(container, 'a.md'), { key: 'z', metaKey: true });
    expect(h.undoLastMove).not.toHaveBeenCalled();
  });
});
