/**
 * @vitest-environment happy-dom
 *
 * ThoughtbaseProperties dialog (#1443). Rename (Part A) + the Advanced base-IRI
 * tier (Part B): change is sent only when edited, disabled while proposals are
 * pending, and a refusal/error from the save is surfaced inline.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  notebase: {
    getProperties: vi.fn(async () => ({
      displayName: 'Current',
      folderName: 'my-folder',
      baseUri: 'https://project.minerva.dev/u/p/',
      pendingProposalCount: 0,
    })),
  },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api }));

import ThoughtbaseProperties from '../../../src/renderer/lib/components/ThoughtbaseProperties.svelte';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const ok = async () => ({ ok: true as const });

describe('ThoughtbaseProperties', () => {
  it('renames, sending no baseUri when the base is unchanged', async () => {
    const onSave = vi.fn(ok);
    const { getByLabelText, getByText, findByDisplayValue } = render(ThoughtbaseProperties, { onSave, onCancel: vi.fn() });
    await findByDisplayValue('Current');
    await fireEvent.input(getByLabelText('Name'), { target: { value: '  Renamed  ' } });
    await fireEvent.click(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith({ name: 'Renamed' }); // no baseUri key
  });

  it('sends the trimmed baseUri when the advanced field is edited', async () => {
    const onSave = vi.fn(ok);
    const { getByLabelText, getByText, findByDisplayValue } = render(ThoughtbaseProperties, { onSave, onCancel: vi.fn() });
    await findByDisplayValue('Current');
    await fireEvent.input(getByLabelText('Graph base IRI'), { target: { value: '  https://new.example/base/  ' } });
    await fireEvent.click(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith({ name: 'Current', baseUri: 'https://new.example/base/' });
  });

  it('locks the base IRI field while proposals are pending', async () => {
    api.notebase.getProperties.mockResolvedValueOnce({
      displayName: 'Current', folderName: 'my-folder', baseUri: 'https://project.minerva.dev/u/p/', pendingProposalCount: 3,
    });
    const { getByLabelText, findByText } = render(ThoughtbaseProperties, { onSave: vi.fn(ok), onCancel: vi.fn() });
    await findByText(/3 proposals await review/);
    expect((getByLabelText('Graph base IRI') as HTMLInputElement).disabled).toBe(true);
  });

  it('surfaces a save refusal inline and keeps the dialog open', async () => {
    const onSave = vi.fn(async () => ({ ok: false as const, error: 'Resolve the 2 pending proposal(s) first.' }));
    const onCancel = vi.fn();
    const { getByLabelText, getByText, findByText, findByDisplayValue } = render(ThoughtbaseProperties, { onSave, onCancel });
    await findByDisplayValue('Current');
    await fireEvent.input(getByLabelText('Graph base IRI'), { target: { value: 'https://new.example/base/' } });
    await fireEvent.click(getByText('Save'));
    await findByText(/Resolve the 2 pending/);
    expect(onCancel).not.toHaveBeenCalled(); // stays open
  });

  it('Cancel fires onCancel without saving', async () => {
    const onSave = vi.fn(ok);
    const onCancel = vi.fn();
    const { getByText } = render(ThoughtbaseProperties, { onSave, onCancel });
    await fireEvent.click(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
