/**
 * @vitest-environment happy-dom
 *
 * Right-sidebar TablesPanel render: the two-section split (referenced vs.
 * defined-in-this-note). Mocks `api.tables.list` so the panel's async refresh
 * effect resolves to a known table set; asserts both section headers + rows
 * render and that a row click opens `SELECT * FROM <name>`.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { TableInfo } from '../../../../src/renderer/lib/ipc/client';

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
  expect(onOpenQuery).toHaveBeenCalledWith('SELECT * FROM sales');
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
