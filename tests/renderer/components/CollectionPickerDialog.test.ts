/**
 * @vitest-environment happy-dom
 *
 * Component-interaction coverage for the collection quick-picker (#470).
 *
 * CollectionPickerDialog is a pure props-and-callbacks leaf — no `window.api`,
 * no store. It builds breadcrumb labels for nested collections, filters them by
 * a typed query, drives selection with the keyboard, and (when handed an
 * `onCreate`) offers a one-shot "make + pick" create row. These tests render the
 * real component and assert the visible list + that pick/create/cancel reach the
 * callbacks with the right ids — so a broken $derived (labels not narrowing, the
 * create-row offset drifting from the rendered rows) fails the suite.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within, waitFor } from '@testing-library/svelte';
import type { Collection } from '../../../src/shared/types';
import CollectionPickerDialog from '../../../src/renderer/lib/components/CollectionPickerDialog.svelte';

afterEach(cleanup);

function makeCollections(): Collection[] {
  return [
    { id: 'work', name: 'Work', parent: null, members: ['s1', 's2'] },
    { id: 'personal', name: 'Personal', parent: null, members: [] },
    // Nested under Work → breadcrumb "Work / Project X".
    { id: 'proj', name: 'Project X', parent: 'work', members: ['s3'] },
  ];
}

function renderDialog(
  over: {
    collections?: Collection[];
    onSelect?: (id: string) => void;
    onCancel?: () => void;
    onCreate?: (name: string) => Promise<string>;
    title?: string;
  } = {},
) {
  const onSelect = over.onSelect ?? vi.fn();
  const onCancel = over.onCancel ?? vi.fn();
  const props: Record<string, unknown> = {
    collections: over.collections ?? makeCollections(),
    onSelect,
    onCancel,
    title: over.title ?? 'Add to collection',
  };
  if (over.onCreate) props.onCreate = over.onCreate;
  const r = render(CollectionPickerDialog, props);
  return { ...r, onSelect, onCancel };
}

/** Visible non-create result rows, in DOM order, by their rendered label. */
function resultNames(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll('.cp-results .result-item:not(.create-row) .result-name'),
  ].map((el) => (el.textContent ?? '').trim());
}

function selectedName(container: HTMLElement): string | null {
  const el = container.querySelector('.result-item.selected .result-name');
  return el ? (el.textContent ?? '').trim() : null;
}

async function type(input: Element, value: string) {
  await fireEvent.input(input, { target: { value } });
}

describe('CollectionPickerDialog — pick / filter / create (#470)', () => {
  it('lists collections alphabetically by breadcrumb label with member counts', () => {
    const { container } = renderDialog();
    // Sorted by full label: "Personal", "Work", "Work / Project X".
    expect(resultNames(container)).toEqual(['Personal', 'Work', 'Work / Project X']);

    const counts = [...container.querySelectorAll('.cp-results .result-count')].map(
      (el) => (el.textContent ?? '').trim(),
    );
    // Personal(0), Work(2), Work / Project X(1).
    expect(counts).toEqual(['0', '2', '1']);
  });

  it('renders the dialog title', () => {
    const { getByText } = renderDialog({ title: 'Move source to…' });
    expect(getByText('Move source to…')).toBeTruthy();
  });

  it('typing filters against the full breadcrumb label ($derived)', async () => {
    const { container, getByRole } = renderDialog();
    const input = getByRole('textbox');

    // "project" matches only the nested collection's label.
    await type(input, 'project');
    expect(resultNames(container)).toEqual(['Work / Project X']);

    // "work" matches Work AND its nested child (breadcrumb contains "Work").
    await type(input, 'work');
    expect(resultNames(container)).toEqual(['Work', 'Work / Project X']);
  });

  it('clicking a row selects that collection id', async () => {
    const onSelect = vi.fn();
    const { container } = renderDialog({ onSelect });
    const list = container.querySelector('.cp-results') as HTMLElement;

    await fireEvent.click(within(list).getByText('Work / Project X'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('proj');
  });

  it('ArrowDown moves the highlight; Enter selects the highlighted row', async () => {
    const onSelect = vi.fn();
    const { container } = renderDialog({ onSelect });
    const overlay = container.querySelector('.overlay')!;

    // Row 0 (Personal) is highlighted initially by the reset $effect.
    expect(selectedName(container)).toBe('Personal');

    await fireEvent.keyDown(overlay, { key: 'ArrowDown' }); // → Work
    expect(selectedName(container)).toBe('Work');

    await fireEvent.keyDown(overlay, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('work');
  });

  it('Escape cancels without selecting', async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const { container } = renderDialog({ onSelect, onCancel });

    await fireEvent.keyDown(container.querySelector('.overlay')!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('mousedown on the backdrop cancels; mousedown inside the dialog does not', async () => {
    const onCancel = vi.fn();
    const { container } = renderDialog({ onCancel });
    const overlay = container.querySelector('.overlay') as HTMLElement;
    const dialog = container.querySelector('.dialog') as HTMLElement;

    await fireEvent.mouseDown(dialog);
    expect(onCancel).not.toHaveBeenCalled();

    await fireEvent.mouseDown(overlay);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the "No matching collections" empty state when a filter matches nothing', async () => {
    const { container, getByText } = renderDialog();
    await type(container.querySelector('.input')!, 'zzzqqq');
    expect(resultNames(container)).toEqual([]);
    expect(getByText('No matching collections.')).toBeTruthy();
  });

  it('with no collections and no onCreate, shows the Sources-panel hint', () => {
    const { getByText } = renderDialog({ collections: [] });
    expect(getByText(/No collections yet\. Create one from the Sources panel first\./)).toBeTruthy();
  });

  it('with no collections but an onCreate, invites typing a name', () => {
    const { getByText } = renderDialog({ collections: [], onCreate: vi.fn() });
    expect(getByText(/No collections yet\. Type a name to create one\./)).toBeTruthy();
  });

  describe('inline create row (onCreate provided)', () => {
    it('offers a create row when the typed name matches no existing collection', async () => {
      const { container, getByText } = renderDialog({ onCreate: vi.fn() });
      await type(container.querySelector('.input')!, 'Reading List');

      const createRow = container.querySelector('.create-row');
      expect(createRow).toBeTruthy();
      expect(getByText('Create new collection:')).toBeTruthy();
      expect(within(createRow as HTMLElement).getByText('Reading List')).toBeTruthy();
    });

    it('hides the create row when the typed name equals an existing collection (case-insensitive)', async () => {
      const { container } = renderDialog({ onCreate: vi.fn() });
      await type(container.querySelector('.input')!, 'work');
      expect(container.querySelector('.create-row')).toBeNull();
    });

    it('clicking the create row calls onCreate then auto-selects the new id', async () => {
      const onCreate = vi.fn().mockResolvedValue('new-collection-id');
      const onSelect = vi.fn();
      const { container } = renderDialog({ onCreate, onSelect });

      await type(container.querySelector('.input')!, 'Reading List');
      await fireEvent.click(container.querySelector('.create-row') as HTMLElement);

      expect(onCreate).toHaveBeenCalledWith('Reading List');
      await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new-collection-id'));
    });

    it('the create row sits at index 0 and Enter activates it', async () => {
      const onCreate = vi.fn().mockResolvedValue('minted-id');
      const onSelect = vi.fn();
      const { container } = renderDialog({ onCreate, onSelect });

      await type(container.querySelector('.input')!, 'Reading List');
      // The reset $effect puts selection at 0 (the create row).
      await fireEvent.keyDown(container.querySelector('.overlay')!, { key: 'Enter' });

      expect(onCreate).toHaveBeenCalledWith('Reading List');
      await waitFor(() => expect(onSelect).toHaveBeenCalledWith('minted-id'));
    });
  });
});
