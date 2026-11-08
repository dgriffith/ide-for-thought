/**
 * @vitest-environment happy-dom
 *
 * A view renders from a SOURCE (#2943): a schema and rows, not a type. An
 * in-memory source with no type behind it draws a table and a list from its
 * columns alone, sorts and opens its notes; the type's own controls (Copy /
 * Save as markdown, moves) aren't offered; a refresh asks the source again,
 * and a new source is a new view. The type source is exercised by every other
 * TypeView suite, unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, within, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { instancesMock } = vi.hoisted(() => ({ instancesMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    types: { instances: instancesMock, list: async () => ({ types: [], errors: [] }), noteTypeMap: async () => ({}) },
    export: { csv: vi.fn() }, app: { getSystemLocale: async () => 'en-GB' },
  },
}));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { rowsSource, typeSource } from '../../../src/renderer/lib/components/type-view/view-source';
import type { TypeInfo } from '../../../src/shared/objects/type-def';

const SCHEMA: TypeInfo = {
  id: 'query:open-tasks', label: 'Open tasks', classLocalName: '', icon: '☑',
  properties: [
    { name: 'status', type: 'enum', options: ['todo', 'doing'] },
    { name: 'due', type: 'date' },
  ],
};
const ROWS = [
  { path: 'tasks/Mow.md', title: 'Mow', values: { status: 'todo', due: '2026-11-01' }, cover: null },
  { path: 'tasks/Paint.md', title: 'Paint the shed', values: { status: 'doing', due: '2026-10-07' }, cover: null },
];

function props(over: Record<string, unknown> = {}) {
  return {
    source: rowsSource('test:tasks', { schema: SCHEMA, rows: ROWS }),
    layout: 'table' as const, sortColumn: null, sortDir: 'asc' as const, columns: null, revision: 0,
    onStateChange: vi.fn(), onOpenNote: vi.fn(), onSaveView: vi.fn(async () => true),
    ...over,
  };
}

beforeEach(() => { instancesMock.mockReset(); });
afterEach(() => cleanup());

describe('a view from a source with no type behind it (#2943)', () => {
  it('draws a table from the schema\'s columns and rows, and never asks for a type', async () => {
    const { container } = render(TypeView, props());
    await waitFor(() => expect(container.querySelector('table')).toBeTruthy());
    expect(container.querySelector('.tv-title')!.textContent).toBe('Open tasks');
    const heads = [...container.querySelectorAll('th')].map((th) => th.textContent.trim());
    expect(heads.join(' ')).toMatch(/Title.*status.*due/i);
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('Mow');
    expect(rows[1]).toContain('Paint the shed');
    expect(instancesMock).not.toHaveBeenCalled();
  });

  it('draws a list too, and opens a row\'s note', async () => {
    const onOpenNote = vi.fn();
    const { container } = render(TypeView, props({ layout: 'list', onOpenNote }));
    await waitFor(() => expect(within(container).getByText('Paint the shed')).toBeTruthy());
    await fireEvent.click(within(container).getByText('Paint the shed'));
    expect(onOpenNote).toHaveBeenCalledWith('tasks/Paint.md');
  });

  it('sorts by a column through the tab state, as a type view does', async () => {
    const onStateChange = vi.fn();
    const { container, rerender } = render(TypeView, props({ onStateChange }));
    await waitFor(() => expect(container.querySelector('table')).toBeTruthy());
    await fireEvent.click([...container.querySelectorAll('th')].find((th) => /due/i.test(th.textContent ?? ''))!);
    expect(onStateChange).toHaveBeenCalledWith({ sortColumn: 'due', sortDir: 'asc' });
    await rerender(props({ onStateChange, sortColumn: 'due', sortDir: 'asc' }));
    const first = container.querySelector('tbody tr')!.textContent;
    expect(first).toContain('Paint the shed'); // 2026-10-07 before 2026-11-01
  });

  it('offers none of a type\'s own controls: no Copy as markdown, no Save as note', async () => {
    render(TypeView, props());
    await screen.findByText('Open tasks');
    expect(screen.queryByRole('button', { name: 'Copy as markdown' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as note' })).toBeNull();
  });

  it('a refresh asks the source again; a new source is a new view', async () => {
    const load = vi.fn(async () => ({ schema: SCHEMA, rows: ROWS }));
    const source = rowsSource('test:a', load);
    const { rerender, container } = render(TypeView, props({ source }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await rerender(props({ source, revision: 1 }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    const other = rowsSource('test:b', { schema: { ...SCHEMA, label: 'Done tasks' }, rows: [] });
    await rerender(props({ source: other }));
    await waitFor(() => expect(container.querySelector('.tv-title')!.textContent).toBe('Done tasks'));
  });
});

describe('the type source (#2943)', () => {
  it('is today\'s fetch: the type and its instances, by id', async () => {
    instancesMock.mockResolvedValue({ type: SCHEMA, instances: ROWS });
    const src = typeSource('task');
    expect(src).toMatchObject({ key: 'type:task', typeId: 'task' });
    expect(await src.load({ needCatalog: false })).toEqual({ schema: SCHEMA, rows: ROWS });
    expect(instancesMock).toHaveBeenCalledWith('task');
  });
});
