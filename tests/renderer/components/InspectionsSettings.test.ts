/**
 * @vitest-environment happy-dom
 *
 * Inspections settings panel (#1792).
 *
 * The load-bearing assertion is the one about what ISN'T here: the argument-map
 * checks must not appear, because they belong to a feature that isn't
 * user-facing yet. A panel that quietly grew an "Unsupported claims" switch
 * would be advertising something the docs don't describe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { DEFAULT_INSPECTION_SETTINGS } from '../../../src/shared/inspections';
import { silenceLogTags } from '../../helpers/quiet-logs';

const api = vi.hoisted(() => ({
  graph: {
    inspectionSettings: vi.fn(async () => ({ disabled: [] as string[], staleDays: 30, stubDays: 30 })),
    setInspectionSettings: vi.fn(async (s: unknown) => s),
    inspectionPluginChecks: vi.fn(async () => [] as unknown[]),
    inspectionThoughtbaseChecks: vi.fn(async () => ({ checks: [] as unknown[], problems: [] as unknown[] })),
  },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api }));

import InspectionsSettings from '../../../src/renderer/lib/components/InspectionsSettings.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  api.graph.inspectionSettings.mockResolvedValue({ ...DEFAULT_INSPECTION_SETTINGS });
  api.graph.setInspectionSettings.mockImplementation(async (s: unknown) => s);
  api.graph.inspectionPluginChecks.mockResolvedValue([]);
  api.graph.inspectionThoughtbaseChecks.mockResolvedValue({ checks: [], problems: [] });
});
afterEach(() => cleanup());

describe("InspectionsSettings — the thoughtbase's own checks (#2874)", () => {
  it('lists them under the thoughtbase, says when one was stopped, and names the files it refused', async () => {
    api.graph.inspectionThoughtbaseChecks.mockResolvedValue({
      checks: [
        { type: 'thoughtbase:NeedsAuthor', label: 'Books without an author', description: 'Every book should say who wrote it.', group: 'thoughtbase', severity: 'warning' },
        { type: 'thoughtbase:Slow', label: 'A slow one', description: '', group: 'thoughtbase', severity: 'info', stopped: true },
      ],
      problems: [{ file: 'writer.ttl', problem: 'a sh:select must be a SELECT query; a shape can only read the graph' }],
    });
    const view = render(InspectionsSettings);
    expect(await view.findByLabelText('Books without an author')).toBeTruthy();
    expect(view.getByText('From this thoughtbase')).toBeTruthy();
    expect(view.getAllByText(/^Stopped: it took longer than its time limit/)).toHaveLength(1);
    expect(view.getByText(/a sh:select must be a SELECT query/).textContent).toContain('.minerva/shapes/writer.ttl');
  });
});

describe("InspectionsSettings — plugins' checks (#2642)", () => {
  silenceLogTags('settings');
  const CHECK = { type: 'plugin:reading-list/FinishedWithoutDate', label: 'Finished books without a date', description: 'Book notes marked finished that don\'t say when.', group: 'notes', severity: 'info', plugin: { id: 'reading-list', name: 'Reading List' } };

  it('lists them in their group, saying which plugin, and switches them like any check', async () => {
    api.graph.inspectionPluginChecks.mockResolvedValue([CHECK]);
    const view = render(InspectionsSettings);
    const box = await view.findByLabelText('Finished books without a date');
    expect(view.getByText("Book notes marked finished that don't say when. From Reading List.")).toBeTruthy();
    await fireEvent.click(box);
    await waitFor(() => expect(api.graph.setInspectionSettings).toHaveBeenCalled());
    expect((api.graph.setInspectionSettings.mock.calls[0]![0] as { disabled: string[] }).disabled).toEqual(['plugin:reading-list/FinishedWithoutDate']);
  });

  it("still lists the built-ins when the plugins' can't be read", async () => {
    api.graph.inspectionPluginChecks.mockRejectedValue(new Error('nope'));
    const view = render(InspectionsSettings);
    expect(await view.findByText('Stale notes')).toBeTruthy();
  });
});

describe('InspectionsSettings', () => {
  it('lists the user-facing checks', async () => {
    const view = render(InspectionsSettings);
    await view.findByText('Stale notes');
    expect(view.getByText('Broken note links')).toBeTruthy();
    expect(view.getByText('Sources missing details')).toBeTruthy();
    expect(view.getByText('Cited but unread')).toBeTruthy();
  });

  it('does NOT offer the argument-map checks', async () => {
    const view = render(InspectionsSettings);
    await view.findByText('Stale notes');
    for (const hidden of ['Unsupported claims', 'Missing warrants', 'Missing backing', 'Contradictions']) {
      expect(view.queryByText(hidden), `${hidden} should not be advertised yet`).toBeNull();
    }
    expect(view.queryByText('Arguments')).toBeNull();
  });

  it('switching a check off saves it as disabled', async () => {
    const view = render(InspectionsSettings);
    const box = await view.findByLabelText('Stale notes');
    await fireEvent.click(box);

    await waitFor(() => expect(api.graph.setInspectionSettings).toHaveBeenCalled());
    const saved = api.graph.setInspectionSettings.mock.calls[0]![0] as { disabled: string[] };
    expect(saved.disabled).toEqual(['stale_note']);
  });

  it('switching it back on removes it again', async () => {
    api.graph.inspectionSettings.mockResolvedValue({ ...DEFAULT_INSPECTION_SETTINGS, disabled: ['stale_note'] });
    const view = render(InspectionsSettings);
    const box = await view.findByLabelText('Stale notes');
    await fireEvent.click(box);

    await waitFor(() => expect(api.graph.setInspectionSettings).toHaveBeenCalled());
    const saved = api.graph.setInspectionSettings.mock.calls[0]![0] as { disabled: string[] };
    expect(saved.disabled).toEqual([]);
  });

  it('offers the day threshold only for the checks that have one', async () => {
    const view = render(InspectionsSettings);
    await view.findByText('Stale notes');
    expect(view.getByLabelText('Call a note stale after')).toBeTruthy();
    expect(view.getByLabelText('Flag an unresolved stub after')).toBeTruthy();
  });

  it('hides a threshold when its check is off — a dial for something that never runs', async () => {
    api.graph.inspectionSettings.mockResolvedValue({ ...DEFAULT_INSPECTION_SETTINGS, disabled: ['stale_note'] });
    const view = render(InspectionsSettings);
    await view.findByText('Stale notes');
    expect(view.queryByLabelText('Call a note stale after')).toBeNull();
    expect(view.getByLabelText('Flag an unresolved stub after')).toBeTruthy();
  });

  it('saves an edited threshold', async () => {
    const view = render(InspectionsSettings);
    const input = await view.findByLabelText('Call a note stale after');
    await fireEvent.change(input, { target: { value: '90' } });

    await waitFor(() => expect(api.graph.setInspectionSettings).toHaveBeenCalled());
    const saved = api.graph.setInspectionSettings.mock.calls[0]![0] as { staleDays: number };
    expect(saved.staleDays).toBe(90);
  });

  it('adopts what was SAVED, not what was asked for', async () => {
    // Saving clamps out-of-range days; echoing the request back would show the
    // user a number that isn't in the config.
    api.graph.setInspectionSettings.mockResolvedValue({ ...DEFAULT_INSPECTION_SETTINGS, staleDays: 1 });
    const view = render(InspectionsSettings);
    const input = await view.findByLabelText('Call a note stale after');
    await fireEvent.change(input, { target: { value: '0' } });

    await waitFor(() => {
      expect((view.getByLabelText('Call a note stale after') as HTMLInputElement).value).toBe('1');
    });
  });

  it('bulk-disables every visible check, and only those', async () => {
    const view = render(InspectionsSettings);
    await view.findByText('Stale notes');
    await fireEvent.click(view.getByText('Disable all'));

    await waitFor(() => expect(api.graph.setInspectionSettings).toHaveBeenCalled());
    const saved = api.graph.setInspectionSettings.mock.calls[0]![0] as { disabled: string[] };
    expect(saved.disabled).toContain('stale_note');
    expect(saved.disabled).not.toContain('unsupported_claim');
  });
});
