/**
 * @vitest-environment jsdom
 *
 * Moving a Kanban card (#2603), the host's half. Since #2828 the board is
 * the Kanban plugin's, and its moves are the host's (decision 2): the
 * plugin's `ui.showNoteMenu` opens the app's own row menu with *Move to ▸*,
 * its `view.moveCard` and `view.undoMove` run the `kanban-moves` store —
 * mocked here; its own test covers it — and Local History says the move was
 * the plugin's. The board's drags and keys are tests/plugins/kanban/.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within } from '@testing-library/svelte';
import { kanbanHostState, openBoard } from './kanban-host';

const h = vi.hoisted(() => ({
  instances: vi.fn(), list: vi.fn(), noteTypeMap: vi.fn(),
  moveCards: vi.fn(), undoLastMove: vi.fn(),
  plugin: {} as import('./kanban-host').KanbanHostState,
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: h.instances, list: h.list, noteTypeMap: h.noteTypeMap } },
}));
vi.mock('../../../src/renderer/lib/stores/kanban-moves.svelte', () => ({
  getKanbanMoveStore: () => ({ revision: 0, lastMove: null, canUndo: true, moveCards: h.moveCards, undoLastMove: h.undoLastMove }),
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: (...a: unknown[]) => h.plugin.connect(...a) }));
vi.mock('../../../src/renderer/lib/stores/core-plugins.svelte', () => ({ corePluginsStore: { isOn: () => true, name: () => 'Kanban' } }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

/** The host's note actions (#2773). */
function actions() {
  return { editProperties: vi.fn(), addTag: vi.fn(), removeTag: vi.fn(), clearProperty: vi.fn() };
}

const PROJECT = {
  id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock' as const,
  properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'paused', 'done', 'abandoned'] }],
};
const row = (path: string, title: string, status: string | null) => ({ path, title, values: { status }, cover: null });
const ROWS = [row('a.md', 'Alpha', 'active'), row('c.md', 'Charlie', 'active'), row('b.md', 'Bravo', 'done')];
const CAUSE = { cause: 'Moved by Kanban' };

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'project', layout: 'kanban' as const, sortColumn: null, sortDir: 'asc' as const, columns: null,
    revision: 0, onStateChange: vi.fn(), onOpenNote: vi.fn(), noteActions: actions(), ...over,
  };
}

beforeEach(async () => {
  kanbanHostState(h.plugin);
  h.list.mockResolvedValue({ types: [PROJECT], errors: [] });
  h.noteTypeMap.mockResolvedValue({});
  await objectTypesStore.refresh();
  h.instances.mockResolvedValue({ type: PROJECT, instances: ROWS });
  h.moveCards.mockResolvedValue([]);
  h.undoLastMove.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const noTarget = { target: false, label: null };

describe("Kanban: Move to ▸ in the app's row menu (#2603)", () => {
  it('lists every column plus No value; the current one is disabled; a pick moves the card, as the plugin', async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, h.plugin);
    b.host().showNoteMenu!(['a.md'], 10, 10, noTarget);
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Move to/ }));
    const items = within(screen.getByRole('menu', { name: 'Move to' })).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['active', 'paused', 'done', 'abandoned', 'No value']);
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(within(screen.getByRole('menu', { name: 'Move to' })).getByRole('menuitem', { name: 'done' }));
    expect(h.moveCards).toHaveBeenCalledWith([{ path: 'a.md', title: 'Alpha' }], 'status', { value: 'done', label: 'done', kind: 'option' }, CAUSE);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a menu for several notes moves them all, and No value clears the field', async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, h.plugin);
    b.host().showNoteMenu!(['a.md', 'b.md'], 10, 10, noTarget);
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Move to \(2 cards\)/ }));
    expect(within(screen.getByRole('menu', { name: 'Move to' })).getAllByRole('menuitem').every((i) => !(i as HTMLButtonElement).disabled)).toBe(true);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'No value' }));
    expect(h.moveCards).toHaveBeenCalledWith(
      [{ path: 'a.md', title: 'Alpha' }, { path: 'b.md', title: 'Bravo' }], 'status', { value: null, label: 'No value', kind: 'no-value' }, CAUSE,
    );
  });

  it('opens with Move to focused; → opens its submenu at the first enabled column; Enter picks', async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, h.plugin);
    b.host().showNoteMenu!(['a.md'], 10, 10, noTarget);
    const move = await screen.findByRole('menuitem', { name: /Move to/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(move));
    await fireEvent.keyDown(move, { key: 'ArrowRight' });
    expect(move.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('paused');
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('done');
    await fireEvent.click(document.activeElement!);
    expect(h.moveCards).toHaveBeenCalledWith([{ path: 'a.md', title: 'Alpha' }], 'status', expect.objectContaining({ value: 'done' }), CAUSE);
  });

  it("a note a card's field names gets that note's menu, with no Move to", async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, h.plugin);
    b.host().showNoteMenu!(['b.md'], 10, 10, { target: true, label: 'Bravo' });
    expect(await screen.findByRole('menuitem', { name: /Add Tag/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Move to/ })).toBeNull();
  });

  it('a list or table row menu has no Move to', async () => {
    render(TypeView, props({ layout: 'list' }));
    await fireEvent.contextMenu(await screen.findByText('Alpha'));
    expect(screen.getByRole('menuitem', { name: /Edit Properties/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Move to/ })).toBeNull();
  });
});

describe("the plugin's moves are the host's (#2828, decision 2)", () => {
  it('view.moveCard moves the card through the move store, and History says the plugin did', async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, h.plugin);
    b.host().moveCard!('c.md', { value: 'paused', label: 'paused', kind: 'option' });
    expect(h.moveCards).toHaveBeenCalledWith([{ path: 'c.md', title: 'Charlie' }], 'status', { value: 'paused', label: 'paused', kind: 'option' }, CAUSE);
  });

  it('view.undoMove undoes the board\'s last move, as the plugin', async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, h.plugin);
    b.host().undoMove!();
    expect(h.undoLastMove).toHaveBeenCalledWith('board', CAUSE);
  });

  it('the view tells the plugin whether there is a move to undo, and that its notes move', async () => {
    const { container } = render(TypeView, props());
    const b = await openBoard(container, h.plugin);
    expect(b.state()).toMatchObject({ canUndoMove: true, movable: true });
  });

  it('an embedded board moves nothing and offers no Move to', async () => {
    const { container } = render(TypeView, props({ noteActions: undefined, chromeless: true }));
    const b = await openBoard(container, h.plugin);
    expect(b.state()).toMatchObject({ movable: false, rowMenu: false });
    b.host().moveCard!('a.md', { value: 'done', label: 'done', kind: 'option' });
    b.host().undoMove!();
    b.host().showNoteMenu!(['a.md'], 10, 10, noTarget);
    expect(h.moveCards).not.toHaveBeenCalled();
    expect(h.undoLastMove).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
