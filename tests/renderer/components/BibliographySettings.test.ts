/**
 * @vitest-environment happy-dom
 *
 * Render coverage for BibliographySettings (#672) — the CSL citation-style /
 * imported-assets panel extracted from SettingsDialog. Mocks api.bibliography
 * + api.csl and pins the on-mount load, the style change, the imported lists +
 * empty states, import/remove flows, and the import-error banner.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const {
  listStylesMock, getStyleMock, setStyleMock,
  listUserStylesMock, listUserLocalesMock,
  importStyleMock, importLocaleMock, removeStyleMock, removeLocaleMock,
} = vi.hoisted(() => ({
  listStylesMock: vi.fn(),
  getStyleMock: vi.fn(),
  setStyleMock: vi.fn(),
  listUserStylesMock: vi.fn(),
  listUserLocalesMock: vi.fn(),
  importStyleMock: vi.fn(),
  importLocaleMock: vi.fn(),
  removeStyleMock: vi.fn(),
  removeLocaleMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    bibliography: { listStyles: listStylesMock, getStyle: getStyleMock, setStyle: setStyleMock },
    csl: {
      listUserStyles: listUserStylesMock,
      listUserLocales: listUserLocalesMock,
      importStyle: importStyleMock,
      importLocale: importLocaleMock,
      removeStyle: removeStyleMock,
      removeLocale: removeLocaleMock,
    },
  },
}));

import BibliographySettings from '../../../src/renderer/lib/components/BibliographySettings.svelte';

function setup(over: {
  styles?: { id: string; label: string; isUser?: boolean }[];
  current?: string;
  userStyles?: { id: string; label: string; filePath: string }[];
  userLocales?: { id: string; filePath: string }[];
} = {}) {
  listStylesMock.mockResolvedValue(over.styles ?? [
    { id: 'apa', label: 'APA' },
    { id: 'chicago', label: 'Chicago' },
  ]);
  getStyleMock.mockResolvedValue(over.current ?? 'apa');
  listUserStylesMock.mockResolvedValue(over.userStyles ?? []);
  listUserLocalesMock.mockResolvedValue(over.userLocales ?? []);
}

afterEach(() => {
  cleanup();
  [listStylesMock, getStyleMock, setStyleMock, listUserStylesMock, listUserLocalesMock,
    importStyleMock, importLocaleMock, removeStyleMock, removeLocaleMock].forEach((m) => m.mockReset());
});

describe('BibliographySettings (#672)', () => {
  it('loads styles on mount and selects the current one', async () => {
    setup({ current: 'chicago' });
    const { findByDisplayValue } = render(BibliographySettings, {});
    // The select shows the current style's option label.
    expect(await findByDisplayValue('Chicago')).toBeTruthy();
  });

  it('shows empty states when no user styles / locales are imported', async () => {
    setup({ userStyles: [], userLocales: [] });
    const { findByText, getByText } = render(BibliographySettings, {});
    expect(await findByText('No imported styles yet.')).toBeTruthy();
    expect(getByText('No imported locales yet.')).toBeTruthy();
  });

  it('changing the style select persists via api.bibliography.setStyle', async () => {
    setup();
    setStyleMock.mockResolvedValue(undefined);
    const { findByDisplayValue, getByRole } = render(BibliographySettings, {});
    await findByDisplayValue('APA');

    await fireEvent.change(getByRole('combobox'), { target: { value: 'chicago' } });
    expect(setStyleMock).toHaveBeenCalledWith('chicago');
  });

  it('renders imported styles + locales with a Remove action', async () => {
    setup({
      userStyles: [{ id: 'my-style', label: 'My Journal', filePath: '/x/my.csl' }],
      userLocales: [{ id: 'de-DE', filePath: '/x/de.xml' }],
    });
    const { findByText, getByText } = render(BibliographySettings, {});
    expect(await findByText('My Journal')).toBeTruthy();
    expect(getByText('my-style')).toBeTruthy();
    expect(getByText('de-DE')).toBeTruthy();
  });

  it('Import .csl style calls api.csl.importStyle then refreshes', async () => {
    setup();
    importStyleMock.mockResolvedValue(true);
    const { findByText, getByText } = render(BibliographySettings, {});
    await findByText('No imported styles yet.');

    listStylesMock.mockClear();
    await fireEvent.click(getByText('Import .csl style…'));
    await waitFor(() => expect(importStyleMock).toHaveBeenCalled());
    await waitFor(() => expect(listStylesMock).toHaveBeenCalled()); // reloaded
  });

  it('Remove style calls api.csl.removeStyle with the id', async () => {
    setup({ userStyles: [{ id: 'my-style', label: 'My Journal', filePath: '/x/my.csl' }] });
    removeStyleMock.mockResolvedValue(undefined);
    const { findByText, getByText } = render(BibliographySettings, {});
    await findByText('My Journal');

    await fireEvent.click(getByText('Remove'));
    await waitFor(() => expect(removeStyleMock).toHaveBeenCalledWith('my-style'));
  });

  it('surfaces an import error in the banner', async () => {
    setup();
    importLocaleMock.mockRejectedValue(new Error('not valid CSL locale XML'));
    const { findByText, getByText } = render(BibliographySettings, {});
    await findByText('No imported locales yet.');

    await fireEvent.click(getByText('Import locale .xml…'));
    expect(await findByText('not valid CSL locale XML')).toBeTruthy();
  });
});
