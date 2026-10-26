/**
 * @vitest-environment happy-dom
 *
 * The Kanban plugin's board (#2602, #2603, #2614; a plugin since #2828),
 * against a fake plugin API: what it draws from the view Minerva sends, the
 * keyboard, and every call it makes — click, menus, previews, moves, column
 * moves. What the host decides (the columns, the cards' fields, Move to ▸)
 * is tested with TypeView, in tests/renderer/components/TypeViewKanban*.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import Board from '../../../plugins/kanban/src/Board.svelte';
import { FILED, fakeMinerva, row, viewOf } from './fixtures';
import type { PluginViewState } from '../../../plugin-api/index';

afterEach(() => cleanup());

function mount(view: PluginViewState = viewOf(FILED)) {
  const api = fakeMinerva();
  const r = render(Board, { minerva: api.minerva, view });
  const card = (path: string) => r.container.querySelector<HTMLElement>(`[data-kanban-card][data-note-path="${path}"]`)!;
  const column = (value: string) => r.container.querySelector<HTMLElement>(`section.kb-column[data-column-value="${value}"]`)!;
  return { ...r, api, card, column, update: (next: PluginViewState) => r.rerender({ minerva: api.minerva, view: next }) };
}
const columns = (c: HTMLElement) => [...c.querySelectorAll('.kb-column')].map((col) => [
  col.querySelector('.kb-col-label')!.textContent, col.querySelector('.kb-col-count')!.textContent,
]);
const titles = (list: HTMLElement) => within(list).queryAllByRole('listitem').map((li) => li.querySelector('.kb-card-name')!.textContent);

describe('what it draws (#2602)', () => {
  it("a column per group, in the view's order, each a list labelled with its heading and count", () => {
    const { container } = mount();
    expect(columns(container)).toEqual([['active', '2'], ['paused', '1'], ['done', '1'], ['abandoned', '0']]);
    expect(titles(screen.getByRole('list', { name: 'active, 2 cards' }))).toEqual(['Alpha', 'Charlie']);
    expect(titles(screen.getByRole('list', { name: 'abandoned, 0 cards' }))).toEqual([]);
    expect(container.querySelector('[data-column-value="abandoned"] .kb-none')!.textContent).toBe('No cards');
  });

  it("a card is the app's: its type icon, title, and fields as prepared — the grouping property left off", () => {
    const { card } = mount();
    expect(card('a.md').querySelector('.type-icon')!.textContent).toBe('🚀');
    expect([...card('a.md').querySelectorAll('.kb-field')].map((f) => f.textContent)).toEqual(['Priority high', 'Owner Ann']);
  });

  it('carries the hooks moves and column order attach to', () => {
    const { container } = mount(viewOf([...FILED, row('e.md', 'Echo', {})]));
    const cols = [...container.querySelectorAll<HTMLElement>('.kb-column')];
    expect(cols.map((c) => [c.dataset['columnValue'], c.dataset['columnKind']])).toEqual([
      ['active', 'option'], ['paused', 'option'], ['done', 'option'], ['abandoned', 'option'], ['', 'no-value'],
    ]);
    expect(cols.every((c) => c.querySelector('.kb-col-header'))).toBe(true);
    expect(cols[4]!.querySelector('[data-kanban-card]')!.getAttribute('data-note-path')).toBe('e.md');
  });

  it('says so when the type has no choice property to group by', () => {
    mount(viewOf(FILED, { groupProperty: null, groups: [] }));
    expect(screen.getByText(/no choice property to group by/i)).toBeTruthy();
  });

  it("draws the host's selection", () => {
    const { card } = mount(viewOf(FILED, { selected: ['c.md'] }));
    expect(card('c.md').classList.contains('selected')).toBe(true);
    expect(card('c.md').getAttribute('aria-pressed')).toBe('true');
    expect(card('a.md').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the keyboard (#2602)', () => {
  it('the board is one tab stop: only the first card is tabbable to begin with', () => {
    const { container } = mount();
    const tabbable = [...container.querySelectorAll<HTMLElement>('[data-kanban-card]')].filter((c) => c.tabIndex === 0);
    expect(tabbable.map((c) => c.dataset['notePath'])).toEqual(['a.md']);
  });

  it('↑/↓ within a column, ←/→ to the next column with cards, Home/End, ↑ to the header and back', async () => {
    const { container, card } = mount();
    card('a.md').focus();
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    await press('ArrowDown');
    await vi.waitFor(() => expect(document.activeElement).toBe(card('c.md')));
    expect(card('c.md').tabIndex).toBe(0);
    expect(card('a.md').tabIndex).toBe(-1);
    await press('ArrowRight'); // row 2 of active → paused has one card: its last
    await vi.waitFor(() => expect(document.activeElement).toBe(card('d.md')));
    await press('ArrowRight');
    await vi.waitFor(() => expect(document.activeElement).toBe(card('b.md')));
    await press('ArrowRight'); // abandoned is empty and last
    expect(document.activeElement).toBe(card('b.md'));
    await press('ArrowLeft');
    await vi.waitFor(() => expect(document.activeElement).toBe(card('d.md')));
    await press('ArrowLeft');
    await vi.waitFor(() => expect(document.activeElement).toBe(card('a.md')));
    await press('End');
    await vi.waitFor(() => expect(document.activeElement).toBe(card('c.md')));
    await press('Home');
    await vi.waitFor(() => expect(document.activeElement).toBe(card('a.md')));
    await press('ArrowUp');
    expect(document.activeElement).toBe(container.querySelector('.kb-column[data-column-value="active"] .kb-col-menu-btn'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(card('a.md'));
  });

  it('←/→ skip an empty column', async () => {
    const { card } = mount(viewOf([row('a.md', 'Alpha', { status: 'active' }), row('b.md', 'Bravo', { status: 'done' })]));
    card('a.md').focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    await vi.waitFor(() => expect(document.activeElement).toBe(card('b.md')));
  });

  it('⌘A selects every card, and Escape clears a selection — through the view', async () => {
    const { card, api, update } = mount();
    card('a.md').focus();
    await fireEvent.keyDown(card('a.md'), { key: 'a', metaKey: true });
    expect(api.of('view.selectAll')).toHaveLength(1);
    // Nothing selected: Escape is left for the runtime to give focus back.
    const loose = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    card('a.md').dispatchEvent(loose);
    expect(loose.defaultPrevented).toBe(false);
    expect(api.of('view.clearSelection')).toHaveLength(0);
    await update(viewOf(FILED, { selected: ['a.md'] }));
    const clear = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    card('a.md').dispatchEvent(clear);
    expect(clear.defaultPrevented).toBe(true);
    expect(api.of('view.clearSelection')).toHaveLength(1);
  });

  it('⌘A does nothing where the view does not select (an embed)', async () => {
    const { card, api } = mount(viewOf(FILED, { selectable: false }));
    await fireEvent.keyDown(card('a.md'), { key: 'a', metaKey: true });
    expect(api.of('view.selectAll')).toEqual([]);
  });
});

describe('clicks, menus and previews (#2602, #2776, #2710)', () => {
  it("a click is the view's own, with its modifiers; Enter's activation is the same click", async () => {
    const { card, api } = mount();
    expect(card('d.md').tagName).toBe('BUTTON');
    await fireEvent.click(card('d.md'));
    await fireEvent.click(card('a.md'), { metaKey: true, shiftKey: true });
    expect(api.of('view.click')).toEqual([
      { path: 'd.md', meta: false, ctrl: false, shift: false },
      { path: 'a.md', meta: true, ctrl: false, shift: true },
    ]);
  });

  it("a card's menu is the app's: its own, or the selection's when it is in it", async () => {
    const { card, api } = mount(viewOf(FILED, { selected: ['a.md', 'c.md'] }));
    await fireEvent.contextMenu(card('d.md'), { clientX: 5, clientY: 6 });
    await fireEvent.contextMenu(card('a.md'), { clientX: 7, clientY: 8 });
    expect(api.of('ui.showNoteMenu')).toEqual([{ paths: ['d.md'], x: 5, y: 6 }, { paths: ['a.md', 'c.md'], x: 7, y: 8 }]);
  });

  it('the menu key opens the focused card\'s menu', async () => {
    const { card, api } = mount();
    card('c.md').focus();
    await fireEvent.keyDown(card('c.md'), { key: 'F10', shiftKey: true });
    expect(api.of('ui.showNoteMenu')).toEqual([expect.objectContaining({ paths: ['c.md'] })]);
  });

  it('no menu where notes have none', async () => {
    const { card, api } = mount(viewOf(FILED, { rowMenu: false }));
    await fireEvent.contextMenu(card('a.md'));
    expect(api.of('ui.showNoteMenu')).toEqual([]);
  });

  it("a field naming a note has that note's own menu (#2775), by right-click or Enter", async () => {
    const { container, api } = mount(viewOf(FILED, { refPath: (p, v) => (p.name === 'owner' && v ? `people/${v}.md` : null) }));
    const ref = container.querySelector<HTMLElement>('[data-note-path="a.md"] .tv-ref')!;
    expect(ref.textContent).toBe('Ann');
    await fireEvent.contextMenu(ref, { clientX: 1, clientY: 2 });
    expect(api.of('ui.showNoteMenu')).toEqual([{ paths: ['people/Ann.md'], x: 1, y: 2, target: true, label: 'Ann' }]);
    await fireEvent.keyDown(ref, { key: 'Enter' });
    expect(api.of('ui.showNoteMenu')).toHaveLength(2);
  });

  it("hovering or focusing a card shows the app's preview beside it, and leaving lets it go", async () => {
    const { card, api } = mount();
    await fireEvent.pointerEnter(card('a.md'));
    await fireEvent.pointerLeave(card('a.md'));
    card('c.md').focus();
    card('c.md').blur();
    expect(api.of('ui.previewNote').map((p) => [(p as { path: string }).path, (p as { via: string }).via])).toEqual([['a.md', 'pointer'], ['c.md', 'focus']]);
    expect(api.of('ui.hidePreview')).toEqual([{ path: 'a.md', via: 'pointer' }, { path: 'c.md', via: 'focus' }]);
  });

  it("describes the card with what the app's preview says, since aria-describedby can't cross the frame", async () => {
    const { card, api, container } = mount();
    api.emit('preview', { path: 'a.md', description: 'Alpha — the first project.' });
    await tick();
    expect(card('a.md').getAttribute('aria-describedby')).toBe('kb-card-description');
    expect(container.querySelector('#kb-card-description')!.textContent).toBe('Alpha — the first project.');
    expect(card('c.md').hasAttribute('aria-describedby')).toBe(false);
    api.emit('preview', { path: 'a.md', description: null });
    await tick();
    expect(card('a.md').hasAttribute('aria-describedby')).toBe(false);
    expect(container.querySelector('#kb-card-description')).toBeNull();
  });
});

describe('moving cards (#2603)', () => {
  let hit: HTMLElement | null = null;
  const real = document.elementFromPoint;
  beforeEach(() => { document.elementFromPoint = vi.fn(() => hit); });
  afterEach(() => { document.elementFromPoint = real; hit = null; });

  async function drag(from: HTMLElement, to: HTMLElement | null) {
    await fireEvent.pointerDown(from, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    hit = to;
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 12 });
    return async () => {
      await fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 12 });
      await fireEvent.click(from);
    };
  }

  it("dragging onto a column marks it, then asks the view to move the card — and doesn't click it", async () => {
    const { card, column, api } = mount();
    const drop = await drag(card('a.md'), column('done'));
    expect(column('done').hasAttribute('data-drop-target')).toBe(true);
    await drop();
    expect(api.of('view.moveCard')).toEqual([{ path: 'a.md', target: { value: 'done', label: 'done', kind: 'option' } }]);
    expect(api.of('view.click')).toEqual([]);
  });

  it('dropping back on its own column, or outside the board, moves nothing', async () => {
    const { card, column, api } = mount();
    await (await drag(card('a.md'), column('active')))();
    await (await drag(card('a.md'), null))();
    expect(api.of('view.moveCard')).toEqual([]);
  });

  it('⌘Z asks the view to undo the last move', async () => {
    const { card, api } = mount();
    await fireEvent.keyDown(card('a.md'), { key: 'z', metaKey: true });
    expect(api.of('view.undoMove')).toHaveLength(1);
  });

  it('a board whose notes do not move neither drags nor undoes', async () => {
    const { card, column, api } = mount(viewOf(FILED, { movable: false }));
    await (await drag(card('a.md'), column('done')))();
    await fireEvent.keyDown(card('a.md'), { key: 'z', metaKey: true });
    expect(column('done').hasAttribute('data-drop-target')).toBe(false);
    expect(api.of('view.moveCard')).toEqual([]);
    expect(api.of('view.undoMove')).toEqual([]);
  });

  it('a focused card that moved keeps focus in its new column', async () => {
    const { card, update } = mount();
    card('a.md').focus();
    await update(viewOf([row('a.md', 'Alpha', { status: 'done' }), ...FILED.slice(1)], { lastMove: { seq: 1, paths: ['a.md'] } }));
    await vi.waitFor(() => expect(document.activeElement).toBe(card('a.md')));
    expect(card('a.md').closest('.kb-column')!.getAttribute('data-column-value')).toBe('done');
  });

  it('holds the card the user is on through later redraws that drop focus; tabbing on moves the hold', async () => {
    const { card, update } = mount();
    card('a.md').focus();
    const moved = [row('a.md', 'Alpha', { status: 'done' }), ...FILED.slice(1)];
    await update(viewOf(moved, { lastMove: { seq: 1, paths: ['a.md'] } }));
    await vi.waitFor(() => expect(document.activeElement).toBe(card('a.md')));
    // A redraw (say, the view refetching) after focus fell to <body>: put back.
    (document.activeElement as HTMLElement).blur();
    await update(viewOf([...moved], { lastMove: { seq: 1, paths: ['a.md'] } }));
    await vi.waitFor(() => expect(document.activeElement).toBe(card('a.md')));
    // The user tabs to another card: that's the one held now (#2902).
    card('b.md').focus();
    (document.activeElement as HTMLElement).blur();
    await update(viewOf([...moved], { lastMove: { seq: 1, paths: ['a.md'] } }));
    await vi.waitFor(() => expect(document.activeElement).toBe(card('b.md')));
  });

  describe('focus the user took to the app (#2902)', () => {
    let frameFocused = true;
    beforeEach(() => {
      frameFocused = true;
      vi.spyOn(document, 'hasFocus').mockImplementation(() => frameFocused);
    });
    afterEach(() => vi.restoreAllMocks());
    /** Focus leaves the frame for the app: its window blurs, and nothing in it is focused. */
    const leaveForTheApp = () => {
      frameFocused = false;
      (document.activeElement as HTMLElement).blur();
      window.dispatchEvent(new Event('blur'));
    };

    it('is never pulled back into the board by a redraw after a move', async () => {
      const { card, update } = mount();
      card('a.md').focus();
      const moved = [row('a.md', 'Alpha', { status: 'done' }), ...FILED.slice(1)];
      await update(viewOf(moved, { lastMove: { seq: 1, paths: ['a.md'] } }));
      await vi.waitFor(() => expect(document.activeElement).toBe(card('a.md')));
      leaveForTheApp();
      await update(viewOf([...moved], { lastMove: { seq: 1, paths: ['a.md'] } }));
      await new Promise((r) => setTimeout(r, 20));
      expect(document.activeElement).toBe(document.body);
      // Nor when the frame gets focus back later: the hold ended when focus left.
      frameFocused = true;
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 20));
      expect(document.activeElement).toBe(document.body);
    });

    it('a move that lands while the frame is unfocused (picked from the app\'s menu) focuses its card when focus comes back', async () => {
      const { card, update } = mount();
      card('a.md').focus();
      leaveForTheApp();
      await update(viewOf([row('a.md', 'Alpha', { status: 'done' }), ...FILED.slice(1)], { lastMove: { seq: 1, paths: ['a.md'] } }));
      await new Promise((r) => setTimeout(r, 20));
      expect(document.activeElement).toBe(document.body);
      frameFocused = true;
      window.dispatchEvent(new Event('focus'));
      await vi.waitFor(() => expect(document.activeElement).toBe(card('a.md')));
      expect(card('a.md').closest('.kb-column')!.getAttribute('data-column-value')).toBe('done');
    });
  });
});

describe('column order (#2614)', () => {
  const menuFor = (c: HTMLElement, value: string) => c.querySelector<HTMLElement>(`.kb-column[data-column-value="${value}"] .kb-col-menu-btn`)!;

  it("Move column right asks the view, then — once the new order is drawn — announces it and keeps focus", async () => {
    const { container, api, update } = mount();
    menuFor(container, 'active').focus();
    await fireEvent.click(menuFor(container, 'active'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Move column right' }));
    expect(api.of('view.moveColumn')).toEqual([{ key: 'active', target: 'paused', side: 'after' }]);
    await update(viewOf(FILED, { columnOrder: ['paused', 'active'] }));
    await vi.waitFor(() => expect(api.of('ui.announce')).toEqual([{ text: 'Moved active column to position 2 of 4' }]));
    await vi.waitFor(() => expect(document.activeElement).toBe(menuFor(container, 'active')));
  });

  it("at the board's edge the move is offered but disabled", async () => {
    const { container } = mount();
    await fireEvent.click(menuFor(container, 'active'));
    expect(screen.getByRole('menuitem', { name: 'Move column left' }).getAttribute('aria-disabled')).toBe('true');
  });

  it("each header's menu button: named, a menu, not its own tab stop; ↑ from the first card, ←/→/Home/End walk the headers", async () => {
    const { container, card } = mount();
    const btn = menuFor(container, 'active');
    expect(btn.getAttribute('aria-label')).toBe('active column actions');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.tabIndex).toBe(-1);
    card('a.md').focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(btn);
    await fireEvent.keyDown(btn, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(menuFor(container, 'paused'));
    await fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(menuFor(container, 'abandoned')); // an empty column's header is reachable
    await fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(btn);
  });

  it('the menu opens on the button with its first item focused, and Escape closes it with focus back on the button', async () => {
    const { container } = mount();
    const btn = menuFor(container, 'done');
    await fireEvent.click(btn);
    const menu = await screen.findByRole('menu', { name: 'done column' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Move column left', 'Move column right']);
    await vi.waitFor(() => expect(document.activeElement).toBe(items[0]));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(esc);
    await tick();
    expect(esc.defaultPrevented).toBe(true); // not the runtime's "give focus back"
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('a right-click on a header opens the same menu', async () => {
    const { container } = mount();
    await fireEvent.contextMenu(container.querySelector('.kb-column[data-column-value="paused"] .kb-col-header')!);
    expect(await screen.findByRole('menu', { name: 'paused column' })).toBeTruthy();
  });

  it('a column hidden by Show empty columns is skipped: the last visible one moves no further right', async () => {
    const { container, api } = mount(viewOf(FILED, { showEmptyColumns: false }));
    await fireEvent.click(menuFor(container, 'done'));
    const right = within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Move column right' });
    expect(right.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(right);
    expect(api.of('view.moveColumn')).toEqual([]);
  });

  it('a read-only board (an embed) has no column menu and no column drag', () => {
    const { container } = mount(viewOf(FILED, { readOnly: true }));
    expect(container.querySelector('.kb-col-menu-btn')).toBeNull();
    expect(container.querySelector('[data-draggable]')).toBeNull();
  });
});

describe('export mode (#2604)', () => {
  it('draws plain cards — no buttons, no tab stops, no menus — in a wrapping grid', () => {
    const { container } = mount(viewOf(FILED, { exportMode: true, readOnly: true }));
    expect(container.querySelector('.kb-board')!.classList.contains('kb-export')).toBe(true);
    const cards = [...container.querySelectorAll<HTMLElement>('[data-kanban-card]')];
    expect(cards.map((c) => c.tagName)).toEqual(['DIV', 'DIV', 'DIV', 'DIV']);
    expect(container.querySelector('[tabindex], button, .kb-col-menu-btn')).toBeNull();
    expect(cards[0]!.dataset['notePath']).toBe('a.md');
  });
});
