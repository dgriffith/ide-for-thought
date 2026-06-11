/**
 * @vitest-environment happy-dom
 *
 * Render coverage for SitesSettings (#672) — the privileged-sites panel
 * extracted from SettingsDialog. Self-contained: it loads on mount and drives
 * api.sites.*. These tests mock that boundary and pin the list render, the
 * add-form gating, and that each action reaches the right IPC call.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const { listMock, addMock, loginMock, logoutMock, removeMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  addMock: vi.fn(),
  loginMock: vi.fn(),
  logoutMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { sites: { list: listMock, add: addMock, login: loginMock, logout: logoutMock, remove: removeMock } },
}));

import SitesSettings from '../../../src/renderer/lib/components/SitesSettings.svelte';

const site = (over = {}) => ({
  id: 's1', label: 'arXiv', domain: 'arxiv.org', lastLoginAt: null, ...over,
});

afterEach(() => {
  cleanup();
  [listMock, addMock, loginMock, logoutMock, removeMock].forEach((m) => m.mockReset());
});

describe('SitesSettings (#672)', () => {
  it('loads sites on mount and renders the list with last-login "never"', async () => {
    listMock.mockResolvedValue([site({ label: 'arXiv', domain: 'arxiv.org', lastLoginAt: null })]);
    const { findByText, getByText } = render(SitesSettings, {});
    expect(await findByText('arXiv')).toBeTruthy();
    expect(getByText(/arxiv\.org · last login: never/)).toBeTruthy();
  });

  it('shows the empty state when no sites are configured', async () => {
    listMock.mockResolvedValue([]);
    const { findByText } = render(SitesSettings, {});
    expect(await findByText('No sites configured.')).toBeTruthy();
  });

  it('Add is disabled until a domain is typed, then calls api.sites.add', async () => {
    listMock.mockResolvedValue([]);
    addMock.mockResolvedValue(undefined);
    const { findByText, getByPlaceholderText } = render(SitesSettings, {});
    await findByText('No sites configured.');

    const addBtn = (await findByText('Add')).closest('button')!;
    expect(addBtn.disabled).toBe(true);

    await fireEvent.input(getByPlaceholderText('arxiv.org'), { target: { value: 'nature.com' } });
    await fireEvent.input(getByPlaceholderText('Label (optional)'), { target: { value: 'Nature' } });
    expect(addBtn.disabled).toBe(false);

    await fireEvent.click(addBtn);
    expect(addMock).toHaveBeenCalledWith('nature.com', 'Nature');
  });

  it('Login / Logout / Remove reach the matching api.sites call with the site id', async () => {
    listMock.mockResolvedValue([site({ id: 's7' })]);
    loginMock.mockResolvedValue(undefined);
    logoutMock.mockResolvedValue(undefined);
    removeMock.mockResolvedValue(undefined);
    const { findByText, getByText } = render(SitesSettings, {});
    await findByText('arXiv');

    await fireEvent.click(getByText('Login'));
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('s7'));

    await fireEvent.click(getByText('Logout'));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledWith('s7'));

    await fireEvent.click(getByText('Remove'));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('s7'));
  });

  it('formats a real last-login timestamp instead of "never"', async () => {
    listMock.mockResolvedValue([site({ lastLoginAt: '2026-01-02T03:04:05Z' })]);
    const { findByText, queryByText } = render(SitesSettings, {});
    await findByText('arXiv');
    expect(queryByText(/last login: never/)).toBeNull();
  });
});
