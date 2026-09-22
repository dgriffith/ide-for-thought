/**
 * @vitest-environment happy-dom
 *
 * Right-sidebar TablesPanel render: the two-section split (referenced vs.
 * defined-in-this-note). Mocks `api.tables.list` so the panel's async refresh
 * effect resolves to a known table set; asserts both section headers + rows
 * render and that a row click opens `SELECT * FROM <name>`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { TableInfo } from '../../../../src/renderer/lib/ipc/client';
import { selectStarSql } from '../../../../src/renderer/lib/components/right-sidebar/tables-panel-logic';

const h = vi.hoisted(() => ({ api: { tables: { list: vi.fn() } } }));
vi.mock('../../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import TablesPanel from '../../../../src/renderer/lib/components/right-sidebar/TablesPanel.svelte';

const NOTE = 'notes/report.md';
const REGISTERED: TableInfo[] = [
  { name: 'sales', relativePath: NOTE, columns: ['a', 'b'], rowCount: 12, source: 'note', caption: 'Q1 Sales', tableIndex: 0 },
  { name: 'people', relativePath: 'people.csv', columns: ['x'], rowCount: 5, source: 'csv' },
];

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { h.api.tables.list.mockResolvedValue(REGISTERED); });

// A note that defines `sales` (registered above) and queries the csv `people`.
const CONTENT = '# Report\n\n```sql\nSELECT * FROM people\n```\n';

it('renders both sections with the note-defined and referenced tables', async () => {
  const onOpenQuery = vi.fn();
  const { getByText, findByText } = render(TablesPanel, {
    props: { content: CONTENT, activeFilePath: NOTE, revision: 0, onOpenQuery },
  });

  // Defined section: the note's own captioned table.
  await findByText('Defined in this note · 1');
  expect(getByText('sales')).toBeTruthy();
  // Referenced section: the queried csv table.
  expect(getByText('Referenced · 1')).toBeTruthy();
  expect(getByText('people')).toBeTruthy();
});

it('opens SELECT * FROM <name> when a row is clicked', async () => {
  const onOpenQuery = vi.fn();
  const { findByText } = render(TablesPanel, {
    props: { content: CONTENT, activeFilePath: NOTE, revision: 0, onOpenQuery },
  });
  const salesRow = await findByText('sales');
  await fireEvent.click(salesRow);
  expect(onOpenQuery).toHaveBeenCalledWith(selectStarSql('sales'));
});

/**
 * #2228: the panel had three call sites that each built `SELECT * FROM <name>`
 * by hand with no row cap — row click, row Enter/Space, and the inner
 * `SELECT *` button. All three go through `selectStarSql` now, and every one of
 * them is asserted: a cap on two of three is a cap the third route walks past.
 * The gate is "the emitted query carries a LIMIT", not a timing measurement.
 */
describe.each([
  ['row click', async (el: HTMLElement) => { await fireEvent.click(el); }],
  ['row Enter', async (el: HTMLElement) => { await fireEvent.keyDown(el, { key: 'Enter' }); }],
  ['row Space', async (el: HTMLElement) => { await fireEvent.keyDown(el, { key: ' ' }); }],
])('%s hands the query tab a row-capped query', (_label, act) => {
  it('emits a LIMIT', async () => {
    const onOpenQuery = vi.fn();
    const { findByText } = render(TablesPanel, {
      props: { content: CONTENT, activeFilePath: NOTE, revision: 0, onOpenQuery },
    });
    const row = (await findByText('sales')).closest('.row') as HTMLElement;
    await act(row);
    expect(onOpenQuery).toHaveBeenCalledTimes(1);
    const sql = onOpenQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/\bFROM sales\b/);
    expect(sql).toMatch(/\bLIMIT\s+\d+\s*$/i);
  });
});

it('the SELECT * button emits the same row-capped query, and says so in its tooltip', async () => {
  const onOpenQuery = vi.fn();
  const { findAllByText } = render(TablesPanel, {
    props: { content: CONTENT, activeFilePath: NOTE, revision: 0, onOpenQuery },
  });
  const [button] = await findAllByText('SELECT *');
  await fireEvent.click(button!);
  expect(onOpenQuery).toHaveBeenCalledTimes(1);
  expect(onOpenQuery.mock.calls[0]![0]).toMatch(/\bLIMIT\s+\d+\s*$/i);
  // The tooltip is the one place the query is described before it opens, so it
  // must not promise an uncapped SELECT * and then hand over a capped one.
  expect(button!.getAttribute('title')).toMatch(/\bLIMIT\s+\d+$/i);
});

it('lists a table the note both defines and queries in both sections', async () => {
  // Queries `sales` (which this note also defines) plus the csv `people`.
  const content = '```sql\nSELECT * FROM sales JOIN people\n```';
  const { findByText, getByText, getAllByText } = render(TablesPanel, {
    props: { content, activeFilePath: NOTE, revision: 0, onOpenQuery: vi.fn() },
  });
  await findByText('Referenced · 2'); // sales + people
  expect(getByText('Defined in this note · 1')).toBeTruthy();
  // `sales` appears once under Referenced and once under Defined.
  expect(getAllByText('sales')).toHaveLength(2);
});

it('shows the empty state when the note has no tables at all', async () => {
  h.api.tables.list.mockResolvedValue([]);
  const { findByText } = render(TablesPanel, {
    props: { content: '# just prose', activeFilePath: NOTE, revision: 0, onOpenQuery: vi.fn() },
  });
  await findByText('No tables');
});

it('omits the Defined section when nothing is defined in this note', async () => {
  const { findByText, queryByText } = render(TablesPanel, {
    props: { content: CONTENT, activeFilePath: 'notes/other.md', revision: 0, onOpenQuery: vi.fn() },
  });
  // `people` is queried, so Referenced shows; but this note defines nothing.
  await findByText('Referenced · 1');
  await waitFor(() => expect(queryByText(/Defined in this note/)).toBeNull());
});
