/**
 * @vitest-environment happy-dom
 *
 * A note named inside a view (#2775): right-clicking a `link-to-type` value —
 * a Project's owner in a table cell, on a Kanban card — opens the note-actions
 * menu for THE REFERENCED note, says which note it is, and leaves the row
 * selection alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, within, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ instances: vi.fn(), list: vi.fn(), noteTypeMap: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: h.instances, list: h.list, noteTypeMap: h.noteTypeMap }, export: { csv: vi.fn() }, app: { getSystemLocale: async () => 'en-GB' } },
}));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => ({
    files: [
      { name: 'people', relativePath: 'people', isDirectory: true, children: [{ name: 'Ada Lovelace.md', relativePath: 'people/Ada Lovelace.md', isDirectory: false }] },
      { name: 'Engine.md', relativePath: 'Engine.md', isDirectory: false },
    ],
  }),
}));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';

const BASE = 'https://project.minerva.dev/me/tb/';
const PROJECT = {
  id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock' as const,
  properties: [
    { name: 'owner', type: 'link-to-type' as const, targetType: 'person', label: 'Owner' },
    { name: 'status', type: 'enum' as const, options: ['active', 'done'] },
  ],
};
const ROWS = [
  { path: 'Engine.md', title: 'Analytical Engine', values: { owner: `${BASE}note/people/Ada%20Lovelace`, status: 'active' }, cover: null, tags: [] },
  { path: 'Other.md', title: 'Unowned', values: { owner: 'someone unlinked', status: 'done' }, cover: null, tags: [] },
];
const actions = () => ({ editProperties: vi.fn(), addTag: vi.fn(), removeTag: vi.fn(), clearProperty: vi.fn() });
const props = (over: Record<string, unknown> = {}) => ({
  typeId: 'project', layout: 'table' as const, sortColumn: null, sortDir: 'asc' as const, columns: null, revision: 0,
  onStateChange: vi.fn(), onOpenNote: vi.fn(), ...over,
});

beforeEach(() => {
  h.instances.mockResolvedValue({ type: PROJECT, instances: ROWS });
  h.list.mockResolvedValue({ types: [PROJECT], errors: [] });
  h.noteTypeMap.mockResolvedValue({});
});
afterEach(() => cleanup());

describe('a note named inside a view (#2775)', () => {
  it('right-clicking a linked owner acts on the owner, says so, and keeps the row selection', async () => {
    const acts = actions();
    render(TypeView, props({ noteActions: acts }));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    const row = screen.getByText('Analytical Engine').closest('tr')!;
    await fireEvent.click(row, { metaKey: true });
    await fireEvent.contextMenu(screen.getByText('Ada Lovelace'));
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Ada Lovelace');
    expect(within(menu).queryByRole('menuitem', { name: /Remove Tag ▸|Set Property|Clear Property/ })).toBeNull();
    await fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add Tag…' }));
    expect(acts.addTag).toHaveBeenCalledWith(['people/Ada Lovelace.md']);
    expect(row.classList.contains('selected')).toBe(true);
  });

  it('Remove Tag… prompts (no tag chosen), and Edit Properties… opens the owner\'s panel', async () => {
    const acts = actions();
    render(TypeView, props({ noteActions: acts }));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    await fireEvent.contextMenu(screen.getByText('Ada Lovelace'));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Remove Tag…' }));
    expect(acts.removeTag).toHaveBeenCalledWith(['people/Ada Lovelace.md']);
    await fireEvent.contextMenu(screen.getByText('Ada Lovelace'));
    await fireEvent.click(screen.getByRole('menuitem', { name: /Edit Properties/ }));
    expect(acts.editProperties).toHaveBeenCalledWith(['people/Ada Lovelace.md']);
  });

  it('plain text in a link field is not a reference; right-click there is the row\'s menu', async () => {
    render(TypeView, props({ noteActions: actions() }));
    await waitFor(() => expect(screen.getByText('someone unlinked')).toBeTruthy());
    expect(screen.getByText('someone unlinked').closest('.tv-ref')).toBeNull();
    await fireEvent.contextMenu(screen.getByText('someone unlinked'));
    expect(screen.getByRole('menuitem', { name: /Set Property/ })).toBeTruthy();
  });

  it('a Kanban card\'s linked field is a reference too', async () => {
    const acts = actions();
    render(TypeView, props({ layout: 'kanban', groupBy: 'status', noteActions: acts }));
    await waitFor(() => expect(document.querySelector('.kb-card .tv-ref')).not.toBeNull());
    await fireEvent.contextMenu(document.querySelector('.kb-card .tv-ref')!);
    expect(screen.getByRole('menu').textContent).toContain('Ada Lovelace');
    expect(screen.queryByRole('menuitem', { name: /^Move to/ })).toBeNull();
  });

  it('without note actions (an export) a link value is plain text', async () => {
    render(TypeView, props());
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(document.querySelector('.tv-ref')).toBeNull();
  });
});

describe('keyboard access (#2776)', () => {
  const key = (el: Element, init: KeyboardEventInit) => fireEvent.keyDown(el, init);

  it('a row takes focus when it has a menu; Shift+F10 opens it, Enter opens the note', async () => {
    const onOpenNote = vi.fn();
    render(TypeView, props({ noteActions: actions(), onOpenNote }));
    await waitFor(() => expect(screen.getByText('Analytical Engine')).toBeTruthy());
    const row = screen.getByText('Analytical Engine').closest('tr')!;
    expect(row.getAttribute('tabindex')).toBe('0');
    await key(row, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Set Property/ })).toBeTruthy(); // the row's own menu
    await key(screen.getByRole('menu'), { key: 'Escape' });
    await key(row, { key: 'Enter' });
    expect(onOpenNote).toHaveBeenCalledWith('Engine.md');
  });

  it('the ContextMenu key works too', async () => {
    render(TypeView, props({ noteActions: actions() }));
    await waitFor(() => expect(screen.getByText('Analytical Engine')).toBeTruthy());
    await key(screen.getByText('Analytical Engine').closest('tr')!, { key: 'ContextMenu' });
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('a note named in a cell is its own stop: Enter or Shift+F10 opens ITS menu, not the row\'s', async () => {
    render(TypeView, props({ noteActions: actions() }));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    const ref = screen.getByRole('button', { name: 'Ada Lovelace' });
    expect(ref.getAttribute('aria-haspopup')).toBe('menu');
    await key(ref, { key: 'Enter' });
    expect(screen.getByRole('menu').textContent).toContain('Ada Lovelace');
    expect(screen.queryByRole('menuitem', { name: /Set Property/ })).toBeNull();
  });

  it('in an embed (chromeless) the rows still take the menu key', async () => {
    render(TypeView, props({ noteActions: actions(), chromeless: true }));
    await waitFor(() => expect(screen.getByText('Analytical Engine')).toBeTruthy());
    const row = screen.getByText('Analytical Engine').closest('tr')!;
    expect(row.getAttribute('tabindex')).toBe('0');
    await key(row, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: /Add Tag/ })).toBeTruthy();
  });

  it('with no menu (an export) rows aren\'t tab stops and the key does nothing', async () => {
    render(TypeView, props());
    await waitFor(() => expect(screen.getByText('Analytical Engine')).toBeTruthy());
    const row = screen.getByText('Analytical Engine').closest('tr')!;
    expect(row.hasAttribute('tabindex')).toBe(false);
    await key(row, { key: 'F10', shiftKey: true });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a gallery card opens its menu from the keyboard', async () => {
    render(TypeView, props({ layout: 'gallery', noteActions: actions() }));
    await waitFor(() => expect(screen.getByText('Analytical Engine')).toBeTruthy());
    await key(screen.getByText('Analytical Engine').closest('button')!, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('an embedded board\'s card opens the note actions from the keyboard (no Move to)', async () => {
    render(TypeView, props({ layout: 'kanban', groupBy: 'status', noteActions: actions(), chromeless: true }));
    await waitFor(() => expect(document.querySelector('.kb-card')).not.toBeNull());
    await key(document.querySelector('.kb-card')!, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: /Add Tag/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Move to/ })).toBeNull();
  });
});
