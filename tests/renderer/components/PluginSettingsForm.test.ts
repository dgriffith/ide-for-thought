/**
 * @vitest-environment happy-dom
 *
 * A plugin's settings form (#2636), opened from Settings → Plugins: each kind
 * rendered from the schema, only what changed saved, a secret write-only
 * (shown as set or not, cleared on its own), main's refusal shown beside the
 * form, and the plain-text note when this machine can't encrypt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { PluginList, PluginSettingsView } from '../../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  list: vi.fn(), settings: vi.fn(), setSettings: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    plugins: { list: h.list, settings: h.settings, setSettings: h.setSettings, onChanged: () => () => undefined },
  },
}));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ registerSkillInfos: vi.fn() }));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({ objectTypesStore: { refresh: vi.fn() } }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => ({ showConfirm: vi.fn(), showPrompt: vi.fn() }) }));

import PluginsSettings from '../../../src/renderer/lib/components/PluginsSettings.svelte';
import PluginSettingsForm from '../../../src/renderer/lib/components/PluginSettingsForm.svelte';

const VIEW: PluginSettingsView = {
  fields: [
    { key: 'length', title: 'Length', kind: 'enum', options: ['short', 'long'], default: 'short' },
    { key: 'maxItems', title: 'Items', kind: 'number', minimum: 1, maximum: 50, default: 10 },
    { key: 'quotes', title: 'Quotes', kind: 'boolean', default: true },
    { key: 'note', title: 'Note', description: 'Added to each summary.', kind: 'string' },
    { key: 'apiToken', title: 'API token', kind: 'secret' },
  ],
  values: { length: 'short', maxItems: 10, quotes: true },
  secretsSet: { apiToken: true },
  secretsEncrypted: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.settings.mockResolvedValue(VIEW);
  h.setSettings.mockImplementation(async () => VIEW);
});
afterEach(() => cleanup());

const form = () => render(PluginSettingsForm, { id: 'lab', name: 'Lab' });

describe('PluginSettingsForm (#2636)', () => {
  it('renders each kind from the schema, with its value or default', async () => {
    const { findByLabelText, getByLabelText, getByText, queryByTestId } = form();
    expect(((await findByLabelText('Length')) as HTMLSelectElement).value).toBe('short');
    expect((getByLabelText('Items') as HTMLInputElement).value).toBe('10');
    expect((getByLabelText('Quotes') as HTMLInputElement).checked).toBe(true);
    expect(getByText('Added to each summary.')).toBeTruthy();
    const token = getByLabelText('API token') as HTMLInputElement;
    expect(token.type).toBe('password');
    expect(token.value).toBe('');
    expect(token.placeholder).toBe('Saved — type to replace');
    expect(queryByTestId('plugin-plaintext-note')).toBeNull();
    expect(h.settings).toHaveBeenCalledWith('lab');
  });

  it('saves only what changed; an emptied field goes back to its default', async () => {
    const { findByLabelText, getByLabelText, getByRole, findByRole } = form();
    await fireEvent.change(await findByLabelText('Length'), { target: { value: 'long' } });
    await fireEvent.input(getByLabelText('Items'), { target: { value: '' } });
    await fireEvent.click(getByLabelText('Quotes'));
    await fireEvent.input(getByLabelText('Note'), { target: { value: 'Be kind.' } });
    await fireEvent.click(getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setSettings).toHaveBeenCalledWith('lab', { length: 'long', maxItems: null, quotes: false, note: 'Be kind.' }));
    expect((await findByRole('status')).textContent).toBe('Saved.');
  });

  it('a secret is sent only when typed, and Clear clears it on its own', async () => {
    const { findByLabelText, getByRole } = form();
    await fireEvent.input(await findByLabelText('API token'), { target: { value: 'tok-123' } });
    await fireEvent.click(getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setSettings).toHaveBeenLastCalledWith('lab', { apiToken: 'tok-123' }));
    await fireEvent.click(getByRole('button', { name: 'Clear API token' }));
    await waitFor(() => expect(h.setSettings).toHaveBeenLastCalledWith('lab', { apiToken: null }));
  });

  it('nothing changed, nothing sent', async () => {
    const { findByRole } = form();
    await fireEvent.click(await findByRole('button', { name: 'Save' }));
    expect(h.setSettings).not.toHaveBeenCalled();
  });

  it('shows main\'s refusal beside the form', async () => {
    // In range for the input, refused by main all the same (say, a manifest
    // that changed since the form opened).
    h.setSettings.mockRejectedValue(new Error('"Items" must be at most 20.'));
    const { findByLabelText, getByRole, findByRole } = form();
    await fireEvent.input(await findByLabelText('Items'), { target: { value: '30' } });
    await fireEvent.click(getByRole('button', { name: 'Save' }));
    expect((await findByRole('alert')).textContent).toBe('"Items" must be at most 20.');
  });

  it('says so when secrets are saved as plain text here (#2569)', async () => {
    h.settings.mockResolvedValue({ ...VIEW, secretsSet: { apiToken: false }, secretsEncrypted: false });
    const { findByTestId, getByLabelText } = form();
    expect((await findByTestId('plugin-plaintext-note')).textContent).toMatch(/plain text in a file only your user account can read/);
    expect((getByLabelText('API token') as HTMLInputElement).placeholder).toBe('Not set');
  });

  it('opens from a plugin\'s Settings button, for a plugin that has settings', async () => {
    const LIST: PluginList = {
      installed: [
        { id: 'lab', name: 'Lab', version: '1.0.0', description: 'd', enabled: true, source: { kind: 'manual' }, contributes: { skills: 1 }, settings: 5 },
        { id: 'plain', name: 'Plain', version: '1.0.0', description: 'd', enabled: true, source: { kind: 'manual' }, contributes: { skills: 1 } },
      ],
      errors: [],
      folder: '/p',
    };
    h.list.mockResolvedValue(LIST);
    const { findAllByRole, findByRole } = render(PluginsSettings);
    const buttons = await findAllByRole('button', { name: 'Settings' });
    expect(buttons).toHaveLength(1);
    await fireEvent.click(buttons[0]!);
    expect(await findByRole('form', { name: 'Lab settings' })).toBeTruthy();
  });
});
