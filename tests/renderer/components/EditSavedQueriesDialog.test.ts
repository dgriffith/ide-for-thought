/**
 * @vitest-environment happy-dom
 *
 * Component-interaction coverage for the Edit Saved Queries dialog (#314/#315).
 *
 * The dialog reads the saved-query catalog from `window.api.queries.list()` on
 * mount, buckets it by (scope, group), and exposes per-row actions — inline
 * rename, delete, move-between-scopes, per-row group edit — plus a group-header
 * rename and drag-to-reorder. These tests render the real component against a
 * stubbed `window.api.queries` boundary and assert the visible DOM plus that
 * each interaction reaches the IPC layer with the right arguments.
 *
 * Drag-to-reorder uses HTML5 DnD; happy-dom dispatches the drag/drop events but
 * has no real DataTransfer. The component keeps the dragged path in component
 * state (`draggingPath`), not on the event, so the reorder + group-header-drop
 * handlers are still exercisable via fireEvent.dragStart/drop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { SavedQuery } from '../../../src/shared/types';
import EditSavedQueriesDialog from '../../../src/renderer/lib/components/EditSavedQueriesDialog.svelte';

// ── stubbed IPC boundary ─────────────────────────────────────────────────────
const q = vi.hoisted(() => ({
  list: vi.fn(),
  rename: vi.fn(),
  delete: vi.fn(),
  move: vi.fn(),
  setGroup: vi.fn(),
  setOrder: vi.fn(),
}));

function query(over: Partial<SavedQuery> = {}): SavedQuery {
  return {
    id: over.filePath ?? 'id',
    name: 'Query',
    description: '',
    query: 'SELECT * WHERE {}',
    language: 'sparql',
    scope: 'project',
    filePath: 'p/query',
    group: null,
    order: null,
    ...over,
  };
}

// Project ungrouped: Alpha, Delta; Project group "Reports": Beta; Global: Gamma.
// Both project+global buckets present → scope labels shown; a group header
// ("Reports") is rendered for the grouped bucket.
function catalog(): SavedQuery[] {
  return [
    query({ name: 'Alpha', filePath: 'p/alpha', scope: 'project', group: null, order: 0 }),
    query({ name: 'Delta', filePath: 'p/delta', scope: 'project', group: null, order: 1 }),
    query({ name: 'Beta', filePath: 'p/beta', scope: 'project', group: 'Reports' }),
    query({ name: 'Gamma', filePath: 'g/gamma', scope: 'global', group: null }),
  ];
}

beforeEach(() => {
  q.list.mockResolvedValue(catalog());
  q.rename.mockResolvedValue('p/alpha');
  q.delete.mockResolvedValue(undefined);
  q.move.mockResolvedValue('g/alpha');
  q.setGroup.mockResolvedValue(undefined);
  q.setOrder.mockResolvedValue(undefined);
  vi.stubGlobal('api', { queries: q });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderDialog(over: { projectOpen?: boolean; onClose?: () => void } = {}) {
  const onClose = over.onClose ?? vi.fn();
  const utils = render(EditSavedQueriesDialog, {
    projectOpen: over.projectOpen ?? true,
    onClose,
  });
  // Wait for the onMount list() to resolve into rows.
  await utils.findByText('Alpha');
  return { ...utils, onClose };
}

/** Find the <li class="row"> whose visible name matches. */
function rowByName(container: HTMLElement, name: string): HTMLElement {
  const row = [...container.querySelectorAll('li.row')].find(
    (li) => li.querySelector('.name')?.textContent === name,
  );
  if (!row) throw new Error(`row "${name}" not found`);
  return row as HTMLElement;
}

describe('EditSavedQueriesDialog (#314/#315)', () => {
  it('renders the queries from api.queries.list, split by scope with labels + group header', async () => {
    const { container, getByText } = await renderDialog();

    expect(q.list).toHaveBeenCalled();
    // Both scopes present → the scope section labels are shown.
    expect(getByText('Thoughtbase')).toBeTruthy();
    expect(getByText('Global')).toBeTruthy();
    // Group header for the grouped bucket.
    expect(container.querySelector('.group-name')?.textContent).toBe('Reports');
    // All four rows rendered.
    const names = [...container.querySelectorAll('li.row .name')].map((n) => n.textContent);
    expect(names).toEqual(expect.arrayContaining(['Alpha', 'Delta', 'Beta', 'Gamma']));
  });

  it('sorts the ungrouped bucket first even when a grouped query is listed first', async () => {
    // Grouped query precedes the ungrouped one → exercises the b.name===null
    // arm of the bucket sort comparator.
    // "Reports" listed before "Analytics" and the ungrouped "Alpha": exercises
    // both the b.name===null arm and the localeCompare arm of the sort.
    q.list.mockResolvedValue([
      query({ name: 'Beta', filePath: 'p/beta', scope: 'project', group: 'Reports' }),
      query({ name: 'Cara', filePath: 'p/cara', scope: 'project', group: 'Analytics' }),
      query({ name: 'Alpha', filePath: 'p/alpha', scope: 'project', group: null }),
    ]);
    const { container, findByText } = render(EditSavedQueriesDialog, {
      projectOpen: true,
      onClose: vi.fn(),
    });
    await findByText('Alpha');
    // Ungrouped first, then groups alphabetically (Analytics before Reports).
    const html = container.innerHTML;
    expect(html.indexOf('Alpha')).toBeLessThan(html.indexOf('Analytics'));
    expect(html.indexOf('Analytics')).toBeLessThan(html.indexOf('Reports'));
  });

  it('shows the empty state when there are no saved queries', async () => {
    q.list.mockResolvedValue([]);
    const { findByText, container } = render(EditSavedQueriesDialog, {
      projectOpen: true,
      onClose: vi.fn(),
    });
    expect(await findByText('No saved queries yet.')).toBeTruthy();
    expect(container.querySelectorAll('li.row').length).toBe(0);
  });

  it('renames a query inline (Enter commits to api.queries.rename)', async () => {
    const { container } = await renderDialog();
    const row = rowByName(container, 'Alpha');

    await fireEvent.click(row.querySelector('.row-btn')!); // "Rename" is the first .row-btn after group-btn? no — click by text
    // The Rename button is the one labelled "Rename".
    // (re-query to be explicit)
    const renameBtn = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Rename')!;
    await fireEvent.click(renameBtn);

    const input = row.querySelector('input.name-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    await fireEvent.input(input, { target: { value: 'Alpha Renamed' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(q.rename).toHaveBeenCalledWith('p/alpha', 'Alpha Renamed'));
    expect(q.list).toHaveBeenCalledTimes(2); // initial load + reload after rename
  });

  it('does not call rename when the value is unchanged or blank', async () => {
    const { container } = await renderDialog();
    const row = rowByName(container, 'Alpha');
    const renameBtn = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Rename')!;
    await fireEvent.click(renameBtn);

    const input = row.querySelector('input.name-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '   ' } }); // blank after trim
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(container.querySelector('input.name-input')).toBeNull());
    expect(q.rename).not.toHaveBeenCalled();
  });

  it('Escape in the rename input cancels without committing', async () => {
    const { container } = await renderDialog();
    const row = rowByName(container, 'Alpha');
    const renameBtn = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Rename')!;
    await fireEvent.click(renameBtn);

    const input = row.querySelector('input.name-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Nope' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(container.querySelector('input.name-input')).toBeNull());
    expect(q.rename).not.toHaveBeenCalled();
  });

  it('deletes a query via api.queries.delete', async () => {
    const { container } = await renderDialog();
    const row = rowByName(container, 'Delta');
    const delBtn = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!;
    await fireEvent.click(delBtn);

    await waitFor(() => expect(q.delete).toHaveBeenCalledWith('p/delta'));
  });

  it('moves a project query to Global scope', async () => {
    const { container } = await renderDialog();
    const row = rowByName(container, 'Alpha');
    const moveBtn = [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Move to Global')!;
    await fireEvent.click(moveBtn);

    await waitFor(() => expect(q.move).toHaveBeenCalledWith('p/alpha', 'global'));
  });

  it('moves a global query to Thoughtbase when a project is open', async () => {
    const { container } = await renderDialog({ projectOpen: true });
    const row = rowByName(container, 'Gamma');
    const moveBtn = [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Move to Thoughtbase')!;
    expect(moveBtn.hasAttribute('disabled')).toBe(false);
    await fireEvent.click(moveBtn);

    await waitFor(() => expect(q.move).toHaveBeenCalledWith('g/gamma', 'project'));
  });

  it('disables Move-to-Thoughtbase for a global query when no project is open', async () => {
    const { container } = await renderDialog({ projectOpen: false });
    const row = rowByName(container, 'Gamma');
    const moveBtn = [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Move to Thoughtbase')!;
    expect(moveBtn.hasAttribute('disabled')).toBe(true);
    // Clicking the disabled button must not reach IPC (moveScope also guards).
    await fireEvent.click(moveBtn);
    expect(q.move).not.toHaveBeenCalled();
  });

  it('edits a row group via the group button (Enter commits setGroup)', async () => {
    const { container } = await renderDialog();
    const row = rowByName(container, 'Alpha');
    const groupBtn = row.querySelector('.group-btn') as HTMLButtonElement;
    expect(groupBtn.textContent?.trim()).toBe('No group');
    await fireEvent.click(groupBtn);

    const input = row.querySelector('input.group-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    await fireEvent.input(input, { target: { value: 'Reports' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(q.setGroup).toHaveBeenCalledWith('p/alpha', 'Reports'));
  });

  it('clearing a row group commits null; Escape cancels the group edit', async () => {
    const { container } = await renderDialog();
    // Cancel path: Beta already has group "Reports"; open + Escape → no call.
    const beta = rowByName(container, 'Beta');
    await fireEvent.click(beta.querySelector('.group-btn') as HTMLButtonElement);
    const betaInput = beta.querySelector('input.group-input') as HTMLInputElement;
    await fireEvent.input(betaInput, { target: { value: 'Changed' } });
    await fireEvent.keyDown(betaInput, { key: 'Escape' });
    await waitFor(() => expect(beta.querySelector('input.group-input')).toBeNull());
    expect(q.setGroup).not.toHaveBeenCalled();

    // Commit-null path: clear Beta's group to empty → setGroup(path, null).
    await fireEvent.click(beta.querySelector('.group-btn') as HTMLButtonElement);
    const betaInput2 = beta.querySelector('input.group-input') as HTMLInputElement;
    await fireEvent.input(betaInput2, { target: { value: '' } });
    await fireEvent.keyDown(betaInput2, { key: 'Enter' });
    await waitFor(() => expect(q.setGroup).toHaveBeenCalledWith('p/beta', null));
  });

  it('renames a group via the header, re-tagging every query in it', async () => {
    const { container } = await renderDialog();
    const header = container.querySelector('.group-name') as HTMLButtonElement;
    await fireEvent.click(header);

    const input = container.querySelector('input.group-name-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    await fireEvent.input(input, { target: { value: 'Analytics' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    // Only Beta is in project/Reports → one setGroup call re-tagging it.
    await waitFor(() => expect(q.setGroup).toHaveBeenCalledWith('p/beta', 'Analytics'));
  });

  it('Escape on the group-rename header input cancels', async () => {
    const { container } = await renderDialog();
    await fireEvent.click(container.querySelector('.group-name') as HTMLButtonElement);
    const input = container.querySelector('input.group-name-input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'X' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('input.group-name-input')).toBeNull());
    expect(q.setGroup).not.toHaveBeenCalled();
  });

  it('drag-reordering within a bucket applies a new @order via setOrder', async () => {
    const { container } = await renderDialog();
    const alpha = rowByName(container, 'Alpha');
    const delta = rowByName(container, 'Delta');

    await fireEvent.dragStart(alpha);
    await fireEvent.dragOver(delta);
    await fireEvent.drop(delta);

    await waitFor(() => expect(q.setOrder).toHaveBeenCalled());
    const entries = q.setOrder.mock.calls[0][0] as Array<{ filePath: string; order: number }>;
    // Alpha dropped onto Delta → Alpha reinserted at Delta's (post-removal)
    // index 0, i.e. before Delta; contiguous @order reassigned from 0.
    expect(entries.map((e) => e.filePath)).toEqual(['p/alpha', 'p/delta']);
    expect(entries.map((e) => e.order)).toEqual([0, 1]);
  });

  it('dragStart populates the dataTransfer payload when one is present', async () => {
    const { container } = await renderDialog();
    const alpha = rowByName(container, 'Alpha');
    const setData = vi.fn();
    // happy-dom omits dataTransfer; supply one to exercise the effectAllowed/
    // setData branch of handleDragStart.
    await fireEvent.dragStart(alpha, { dataTransfer: { effectAllowed: 'none', setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', 'p/alpha');
  });

  it('dragging a row across groups re-tags it, then reorders in the target bucket', async () => {
    const { container } = await renderDialog();
    const beta = rowByName(container, 'Beta'); // project / "Reports"
    const alpha = rowByName(container, 'Alpha'); // project / ungrouped

    // After the cross-group re-tag, the reload sees Beta as ungrouped so the
    // reorder step can find it in the target bucket.
    q.list.mockResolvedValue(
      catalog().map((x) => (x.filePath === 'p/beta' ? { ...x, group: null } : x)),
    );

    await fireEvent.dragStart(beta);
    await fireEvent.drop(alpha);

    // Cross-group drop first re-tags the source to the target's group (null),
    // then applies a contiguous @order across the target bucket.
    await waitFor(() => expect(q.setGroup).toHaveBeenCalledWith('p/beta', null));
    await waitFor(() => expect(q.setOrder).toHaveBeenCalled());
  });

  it('dropping a row onto a group header re-tags it into that group', async () => {
    const { container } = await renderDialog();
    const alpha = rowByName(container, 'Alpha'); // project, ungrouped
    const header = container.querySelector('.group-header') as HTMLElement;

    await fireEvent.dragStart(alpha);
    await fireEvent.drop(header);

    await waitFor(() => expect(q.setGroup).toHaveBeenCalledWith('p/alpha', 'Reports'));
  });

  it('blur commits each inline editor (rename, row-group, group-header)', async () => {
    const { container } = await renderDialog();

    // Row rename via blur.
    const alpha = rowByName(container, 'Alpha');
    await fireEvent.click([...alpha.querySelectorAll('button')].find((b) => b.textContent === 'Rename')!);
    const nameInput = alpha.querySelector('input.name-input') as HTMLInputElement;
    await fireEvent.input(nameInput, { target: { value: 'Alpha B' } });
    await fireEvent.blur(nameInput);
    await waitFor(() => expect(q.rename).toHaveBeenCalledWith('p/alpha', 'Alpha B'));

    // Row group edit via blur.
    const delta = rowByName(container, 'Delta');
    await fireEvent.click(delta.querySelector('.group-btn') as HTMLButtonElement);
    const groupInput = delta.querySelector('input.group-input') as HTMLInputElement;
    await fireEvent.input(groupInput, { target: { value: 'Ops' } });
    await fireEvent.blur(groupInput);
    await waitFor(() => expect(q.setGroup).toHaveBeenCalledWith('p/delta', 'Ops'));

    // Group-header rename via blur.
    await fireEvent.click(container.querySelector('.group-name') as HTMLButtonElement);
    const headerInput = container.querySelector('input.group-name-input') as HTMLInputElement;
    await fireEvent.input(headerInput, { target: { value: 'Renamed' } });
    await fireEvent.blur(headerInput);
    await waitFor(() => expect(q.setGroup).toHaveBeenCalledWith('p/beta', 'Renamed'));
  });

  it('Close button and Escape (with no inline edit open) both fire onClose', async () => {
    const onClose = vi.fn();
    const { container, getByText } = await renderDialog({ onClose });

    await fireEvent.keyDown(container.querySelector('.overlay')!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('mousedown on the overlay backdrop closes; on the dialog it does not', async () => {
    const onClose = vi.fn();
    const { container } = await renderDialog({ onClose });

    await fireEvent.mouseDown(container.querySelector('.dialog')!);
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.mouseDown(container.querySelector('.overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
