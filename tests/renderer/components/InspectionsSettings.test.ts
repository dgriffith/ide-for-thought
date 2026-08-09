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

const api = vi.hoisted(() => ({
  graph: {
    inspectionSettings: vi.fn(async () => ({ disabled: [] as string[], staleDays: 30, stubDays: 30 })),
    setInspectionSettings: vi.fn(async (s: unknown) => s),
  },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api }));

import InspectionsSettings from '../../../src/renderer/lib/components/InspectionsSettings.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  api.graph.inspectionSettings.mockResolvedValue({ ...DEFAULT_INSPECTION_SETTINGS });
  api.graph.setInspectionSettings.mockImplementation(async (s: unknown) => s);
});
afterEach(() => cleanup());

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
