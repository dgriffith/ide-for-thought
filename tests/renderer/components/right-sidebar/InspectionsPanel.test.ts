/**
 * @vitest-environment happy-dom
 *
 * Right-sidebar InspectionsPanel interaction coverage (~0% before this). The
 * panel lists graph health-check results loaded via `api.graph.inspections()`,
 * groups them by severity (or by type), filters them by a search ribbon, and
 * hands a clicked inspection to `onOpenConversation`. The "Run" button re-runs
 * the checks through the review store (the #1086 mutation chokepoint).
 *
 * These tests render the real component against a mocked `api.graph` boundary
 * and a mocked review store, asserting the grouped DOM, the empty state, the
 * onOpenConversation payload, the search + sort affordances, the Run action,
 * and the reload-on-revision-change path. The grouping/derived logic runs for
 * real; only IPC + the store passthrough are stubbed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

interface Inspection {
  id: string;
  type: string;
  severity: string;
  nodeUri: string;
  nodeLabel: string;
  message: string;
  suggestedAction?: string;
}

const { inspectionsMock, runInspectionsMock } = vi.hoisted(() => ({
  inspectionsMock: vi.fn(),
  runInspectionsMock: vi.fn(),
}));

vi.mock('../../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { inspections: inspectionsMock } },
}));

vi.mock('../../../../src/renderer/lib/stores/review.svelte', () => ({
  getReviewStore: () => ({ runInspections: runInspectionsMock }),
}));

import InspectionsPanel from '../../../../src/renderer/lib/components/right-sidebar/InspectionsPanel.svelte';

afterEach(() => {
  cleanup();
  inspectionsMock.mockReset();
  runInspectionsMock.mockReset();
});

function fixtures(): Inspection[] {
  return [
    { id: 'c1', type: 'missing_grounds', severity: 'concern', nodeUri: 'urn:c', nodeLabel: 'Claim A', message: 'Claim A lacks grounds', suggestedAction: 'Add grounds' },
    { id: 'w1', type: 'stale_note', severity: 'warning', nodeUri: 'urn:w', nodeLabel: 'Note B', message: 'Note B is stale' },
    { id: 'i1', type: 'orphan_node', severity: 'info', nodeUri: 'urn:i', nodeLabel: 'Node C', message: 'Node C is orphaned' },
  ];
}

function renderPanel(over: { revision?: number; onOpenConversation?: (m: string) => void } = {}) {
  const onOpenConversation = over.onOpenConversation ?? vi.fn();
  const utils = render(InspectionsPanel, { revision: over.revision ?? 0, onOpenConversation });
  return { ...utils, onOpenConversation };
}

describe('right-sidebar InspectionsPanel', () => {
  it('renders inspections grouped by severity with counts', async () => {
    inspectionsMock.mockResolvedValue(fixtures());
    const { findByText, getByText } = renderPanel();

    expect(await findByText('Claim A lacks grounds')).toBeTruthy();
    expect(getByText('Note B is stale')).toBeTruthy();
    expect(getByText('Node C is orphaned')).toBeTruthy();

    expect(getByText('Concerns (1)')).toBeTruthy();
    expect(getByText('Warnings (1)')).toBeTruthy();
    expect(getByText('Info (1)')).toBeTruthy();
    expect(getByText('3 inspections')).toBeTruthy();
  });

  it('shows the empty state when there are no inspections', async () => {
    inspectionsMock.mockResolvedValue([]);
    const { findByText } = renderPanel();

    expect(await findByText('No inspections')).toBeTruthy();
  });

  it('clicking an inspection opens a conversation seeded with its message + suggested action', async () => {
    inspectionsMock.mockResolvedValue(fixtures());
    const onOpenConversation = vi.fn();
    const { findByText } = renderPanel({ onOpenConversation });

    await fireEvent.click(await findByText('Claim A lacks grounds'));

    expect(onOpenConversation).toHaveBeenCalledWith(
      'I\'d like to discuss this inspection: "Claim A lacks grounds". Add grounds',
    );
  });

  it('the search ribbon filters the visible inspections', async () => {
    inspectionsMock.mockResolvedValue(fixtures());
    const { findByText, getByPlaceholderText, queryByText } = renderPanel();

    await findByText('Claim A lacks grounds');
    await fireEvent.input(getByPlaceholderText('Find inspection…'), { target: { value: 'Note B' } });

    await waitFor(() => expect(queryByText('Claim A lacks grounds')).toBeNull());
    expect(queryByText('Note B is stale')).toBeTruthy();
    expect(queryByText('Node C is orphaned')).toBeNull();
  });

  it('sorting "by type" regroups the list under type headings', async () => {
    inspectionsMock.mockResolvedValue(fixtures());
    const { findByText, container, getByText } = renderPanel();

    await findByText('Claim A lacks grounds');
    const sort = container.querySelector('select.sort') as HTMLSelectElement;
    await fireEvent.change(sort, { target: { value: 'type' } });

    // Type headings replace the severity headings (underscores → spaces).
    expect(await findByText('missing grounds (1)')).toBeTruthy();
    expect(getByText('stale note (1)')).toBeTruthy();
    expect(getByText('orphan node (1)')).toBeTruthy();
  });

  it('the Run button re-runs the checks through the review store and shows fresh results', async () => {
    inspectionsMock.mockResolvedValue(fixtures());
    runInspectionsMock.mockResolvedValue([
      { id: 'x1', type: 'fresh_check', severity: 'warning', nodeUri: 'urn:x', nodeLabel: 'Fresh', message: 'Fresh finding', suggestedAction: '' },
    ] as Inspection[]);

    const { findByText, getByText } = renderPanel();
    await findByText('Claim A lacks grounds');

    await fireEvent.click(getByText('Run'));

    expect(runInspectionsMock).toHaveBeenCalledTimes(1);
    expect(await findByText('Fresh finding')).toBeTruthy();
  });

  it('reloads inspections when the revision prop changes', async () => {
    inspectionsMock.mockResolvedValue(fixtures());
    const { findByText, rerender } = renderPanel({ revision: 0 });
    await findByText('Claim A lacks grounds');

    inspectionsMock.mockResolvedValue([
      { id: 'r1', type: 'reindexed', severity: 'info', nodeUri: 'urn:r', nodeLabel: 'Reindexed', message: 'A brand new finding' },
    ] as Inspection[]);
    await rerender({ revision: 1, onOpenConversation: vi.fn() });

    expect(await findByText('A brand new finding')).toBeTruthy();
  });
});
