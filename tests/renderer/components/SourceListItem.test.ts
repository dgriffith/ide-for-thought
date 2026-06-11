/**
 * @vitest-environment happy-dom
 *
 * Render coverage for SourceListItem (#672) — the row extracted from
 * SourcesPanel. Pins the extracted markup: title, read-status dot, the
 * author/year/due byline, and the click / right-click callbacks the panel
 * relies on. The pure formatting behind it is unit-tested in
 * tests/renderer/source-display.test.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { SourceMetadata } from '../../../src/shared/types';
import SourceListItem from '../../../src/renderer/lib/components/SourceListItem.svelte';

function source(over: Partial<SourceMetadata> = {}): SourceMetadata {
  return {
    sourceId: 'doi-10.1234_abc',
    subtype: null,
    title: 'On the Origin of Tests',
    creators: ['Curie', 'Joliot'],
    year: '1903',
    publisher: null,
    doi: '10.1234/abc',
    uri: null,
    abstract: null,
    readStatus: 'reading',
    readDueBy: null,
    stubStatus: null,
    ...over,
  };
}

afterEach(cleanup);

describe('SourceListItem (#672)', () => {
  it('renders the display title, byline authors, and year', () => {
    const { getByText } = render(SourceListItem, {
      source: source(),
      onSelect: vi.fn(),
      onContextMenu: vi.fn(),
    });
    expect(getByText('On the Origin of Tests')).toBeTruthy();
    expect(getByText(/Curie and Joliot/)).toBeTruthy();
    expect(getByText('1903')).toBeTruthy();
  });

  it('renders the read-status dot with a human label', () => {
    const { getByLabelText } = render(SourceListItem, {
      source: source({ readStatus: 'reading' }),
      onSelect: vi.fn(),
      onContextMenu: vi.fn(),
    });
    const dot = getByLabelText('Reading');
    expect(dot.textContent).toBe('◐');
  });

  it('omits the byline entirely when there are no creators / year / due date', () => {
    const { container } = render(SourceListItem, {
      source: source({ creators: [], year: null, readDueBy: null }),
      onSelect: vi.fn(),
      onContextMenu: vi.fn(),
    });
    expect(container.querySelector('.source-byline')).toBeNull();
  });

  it('shows a "due" stamp when a read-due date is set', () => {
    const { getByText } = render(SourceListItem, {
      source: source({ readDueBy: '2099-06-15' }),
      onSelect: vi.fn(),
      onContextMenu: vi.fn(),
    });
    expect(getByText(/due/)).toBeTruthy();
  });

  it('clicking the row reports the sourceId to onSelect', async () => {
    const onSelect = vi.fn();
    const { getByRole } = render(SourceListItem, {
      source: source({ sourceId: 'doi-10.1234_abc' }),
      onSelect,
      onContextMenu: vi.fn(),
    });
    await fireEvent.click(getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('doi-10.1234_abc');
  });

  it('right-clicking reports the event + source to onContextMenu', async () => {
    const onContextMenu = vi.fn();
    const src = source();
    const { getByRole } = render(SourceListItem, {
      source: src,
      onSelect: vi.fn(),
      onContextMenu,
    });
    await fireEvent.contextMenu(getByRole('button'));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][1]).toBe(src);
  });

  it('falls back to a readable title when meta.title is null (never the raw id)', () => {
    const { getByText, queryByText } = render(SourceListItem, {
      source: source({ title: null, doi: '10.1234/abc', uri: null }),
      onSelect: vi.fn(),
      onContextMenu: vi.fn(),
    });
    expect(getByText('DOI 10.1234/abc')).toBeTruthy();
    expect(queryByText(/doi-10\.1234_abc/)).toBeNull();
  });
});
