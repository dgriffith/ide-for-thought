/**
 * @vitest-environment happy-dom
 *
 * "Duplicate" in the Type Manager silently did nothing.
 *
 * The list it renders comes from `objectTypesStore.types`, a deeply-reactive
 * `$state` — so `t.properties` / `t.card` read back as Svelte Proxies. Duplicate
 * forwarded those straight into `api.types.save`, and Electron's structured
 * clone refuses to serialize a Proxy: the invoke rejected before reaching main,
 * and with no `catch` on the call it surfaced as an unhandled rejection with
 * nothing on screen.
 *
 * Edit was unaffected because TypeEditorDialog rebuilds its rows into fresh
 * plain objects before saving, which is why only Duplicate broke.
 *
 * Unlike the sibling suite, this drives the REAL store — the bug lives in the
 * hand-off between the component and the store, so mocking the store away
 * would mock away the defect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { saveMock, listMock, noteTypeMapMock, queryMock, toastMock } = vi.hoisted(() => ({
  saveMock: vi.fn(), listMock: vi.fn(), noteTypeMapMock: vi.fn(), queryMock: vi.fn(), toastMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    types: { list: listMock, save: saveMock, noteTypeMap: noteTypeMapMock },
    graph: { query: queryMock },
  },
}));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: vi.fn(), showPrompt: vi.fn() }),
}));
vi.mock('../../../src/renderer/lib/stores/toasts.svelte', () => ({
  getToastStore: () => ({ push: toastMock }),
}));

import ObjectTypesSettings from '../../../src/renderer/lib/components/ObjectTypesSettings.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const GADGET = {
  id: 'gadget', label: 'Gadget', classLocalName: 'Gadget', source: 'user', icon: '🔧',
  card: ['maker'],
  properties: [{ name: 'maker', type: 'text' }, { name: 'model', type: 'text' }],
};

beforeEach(() => {
  listMock.mockResolvedValue({ types: [GADGET], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  queryMock.mockResolvedValue({ results: [], columns: [] });
  saveMock.mockResolvedValue({ id: 'gadget-copy', filePath: '.minerva/types/gadget-copy.md' });
});
afterEach(async () => {
  cleanup();
  listMock.mockResolvedValue({ types: [], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  await objectTypesStore.refresh(); // module singleton — don't leak between suites
  vi.clearAllMocks();
});

describe('Type Manager — Duplicate', () => {
  it('sends a structured-cloneable payload, so the IPC actually reaches main', async () => {
    render(ObjectTypesSettings, {});
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());

    await fireEvent.click(screen.getByText('Duplicate'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());

    const payload = saveMock.mock.calls[0]![0];
    // The real assertion: Electron puts this through structured clone. A Svelte
    // `$state` Proxy throws DataCloneError here exactly as it does over IPC.
    expect(() => structuredClone(payload)).not.toThrow();
  });

  it('carries the source type’s properties and optional fields into the copy', async () => {
    render(ObjectTypesSettings, {});
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());
    await fireEvent.click(screen.getByText('Duplicate'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());

    const payload = saveMock.mock.calls[0]![0];
    expect(payload.label).toBe('Gadget copy');
    expect(payload.id).toBeUndefined(); // a copy derives a NEW id from its label
    expect(payload.icon).toBe('🔧');
    expect(payload.card).toEqual(['maker']);
    expect(payload.properties).toEqual([
      { name: 'maker', type: 'text' },
      { name: 'model', type: 'text' },
    ]);
  });

  it('surfaces a failed duplicate instead of swallowing it', async () => {
    // Previously the call had no `catch`, so any failure was an invisible
    // unhandled rejection — the reason the original bug showed no symptom.
    saveMock.mockRejectedValue(new Error('disk full'));
    render(ObjectTypesSettings, {});
    await waitFor(() => expect(screen.getByText('Gadget')).toBeTruthy());

    await fireEvent.click(screen.getByText('Duplicate'));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0]![0].message).toMatch(/disk full/);
    // The row's buttons must not be left disabled by a stuck `busy` flag.
    expect((screen.getByText('Duplicate')).disabled).toBe(false);
  });
});
