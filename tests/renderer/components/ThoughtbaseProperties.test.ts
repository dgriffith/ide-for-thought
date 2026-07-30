/**
 * @vitest-environment happy-dom
 *
 * ThoughtbaseProperties dialog (#1443, Part A). Loads current values, saves the
 * trimmed name via the `onSave` callback (App routes it through the notebase
 * store), and cancels cleanly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  notebase: { getProperties: vi.fn(async () => ({ displayName: 'Current', folderName: 'my-folder' })) },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api }));

import ThoughtbaseProperties from '../../../src/renderer/lib/components/ThoughtbaseProperties.svelte';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('ThoughtbaseProperties', () => {
  it('loads the current name and saves a trimmed new one', async () => {
    const onSave = vi.fn();
    const { getByLabelText, getByText, findByDisplayValue } = render(ThoughtbaseProperties, { onSave, onCancel: vi.fn() });
    await findByDisplayValue('Current'); // getProperties resolved + populated
    await fireEvent.input(getByLabelText('Name'), { target: { value: '  Renamed  ' } });
    await fireEvent.click(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith('Renamed');
  });

  it('shows the folder name as the placeholder (the blank-fallback)', async () => {
    const { getByLabelText } = render(ThoughtbaseProperties, { onSave: vi.fn(), onCancel: vi.fn() });
    await vi.waitFor(() => expect((getByLabelText('Name') as HTMLInputElement).placeholder).toBe('my-folder'));
  });

  it('Cancel fires onCancel without saving', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(ThoughtbaseProperties, { onSave, onCancel });
    await fireEvent.click(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
