/**
 * @vitest-environment happy-dom
 *
 * The recommended-plugins card (#2635), with the real plugins store: it lists
 * what the thoughtbase recommends and does nothing until the user presses a
 * button — Install sends the listed git URL, Turn on enables an installed
 * one, and an address Minerva can't install from is shown without a button.
 * "Not now" and "Don't show again" both hide it; only the second outlives a
 * reopen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { PluginRecommendation } from '../../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  list: vi.fn(), setEnabled: vi.fn(), installGit: vi.fn(), recommendations: vi.fn(), openSettings: vi.fn(),
  skillsList: vi.fn(), typesRefresh: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    plugins: {
      list: h.list, setEnabled: h.setEnabled, installGit: h.installGit, recommendations: h.recommendations,
      onChanged: () => () => undefined,
    },
    skills: { list: h.skillsList },
  },
}));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ registerSkillInfos: vi.fn() }));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({ objectTypesStore: { refresh: h.typesRefresh } }));
vi.mock('../../../src/renderer/lib/stores/feature-dialogs.svelte', () => ({ getFeatureDialogStore: () => ({ openSettings: h.openSettings }) }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: vi.fn() }));

import PluginRecommendations from '../../../src/renderer/lib/components/PluginRecommendations.svelte';
import PluginsSettings from '../../../src/renderer/lib/components/PluginsSettings.svelte';

const RECS: PluginRecommendation[] = [
  { id: 'reading-list', name: 'Reading List', reason: 'Book notes use its type.', source: 'https://github.com/ada/reading-list#v1', installUrl: 'https://github.com/ada/reading-list#v1', types: ['book-note'], status: 'missing' },
  { id: 'lab', name: 'Lab', types: [], status: 'disabled' },
  { id: 'paper', source: 'https://example.org/how-to-get-paper', types: [], status: 'missing' },
];

let root = 0;
const nextRoot = () => `/tb/${++root}`;

beforeEach(() => {
  vi.clearAllMocks();
  h.recommendations.mockResolvedValue(RECS);
  h.list.mockResolvedValue({ core: [], installed: [], errors: [], folder: '/p' });
  h.installGit.mockResolvedValue({ id: 'reading-list', name: 'Reading List' });
  h.setEnabled.mockResolvedValue({ core: [], installed: [], errors: [], folder: '/p' });
  localStorage.clear();
});
afterEach(() => cleanup());

describe('PluginRecommendations (#2635)', () => {
  it('lists the recommendations and installs nothing by itself', async () => {
    const { findByText, getByText, queryAllByRole } = render(PluginRecommendations, { rootPath: nextRoot() });
    await findByText('Reading List');
    expect(getByText('Book notes use its type.')).toBeTruthy();
    expect(getByText('book-note')).toBeTruthy();
    expect(getByText('Installed, turned off')).toBeTruthy();
    expect(h.installGit).not.toHaveBeenCalled();
    expect(h.setEnabled).not.toHaveBeenCalled();
    // An address Minerva can't install from gets no button.
    expect(getByText('https://example.org/how-to-get-paper')).toBeTruthy();
    expect(queryAllByRole('button', { name: 'Install' })).toHaveLength(1);
  });

  it('Install sends the listed git URL, and Turn on enables the installed one — on a press', async () => {
    const { findByRole, getByRole } = render(PluginRecommendations, { rootPath: nextRoot() });
    await fireEvent.click(await findByRole('button', { name: 'Install' }));
    await waitFor(() => expect(h.installGit).toHaveBeenCalledWith('https://github.com/ada/reading-list#v1'));
    await waitFor(() => expect((getByRole('button', { name: 'Turn on' }) as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(h.setEnabled).toHaveBeenCalledWith('lab', true));
  });

  it('a failed install says why, in the card', async () => {
    h.installGit.mockRejectedValue(new Error('Couldn\'t reach the repository.'));
    const { findByRole } = render(PluginRecommendations, { rootPath: nextRoot() });
    await fireEvent.click(await findByRole('button', { name: 'Install' }));
    expect((await findByRole('alert')).textContent).toContain('Couldn\'t reach the repository.');
  });

  it('"Not now" hides it until the thoughtbase is reopened', async () => {
    const tb = nextRoot();
    const first = render(PluginRecommendations, { rootPath: tb });
    await first.findByText('Reading List');
    await fireEvent.click(first.getAllByRole('button', { name: 'Not now' })[0]!);
    await waitFor(() => expect(first.queryByText('Reading List')).toBeNull());
    expect(localStorage.length).toBe(0);
  });

  it('"Don\'t show again" is remembered for this thoughtbase, and not for another', async () => {
    const tb = nextRoot();
    const first = render(PluginRecommendations, { rootPath: tb });
    await fireEvent.click(await first.findByRole('button', { name: 'Don\'t show again' }));
    await waitFor(() => expect(first.queryByText('Reading List')).toBeNull());
    cleanup();

    const again = render(PluginRecommendations, { rootPath: tb });
    await waitFor(() => expect(h.recommendations).toHaveBeenCalledTimes(2));
    expect(again.queryByText('Reading List')).toBeNull();
    cleanup();

    const other = render(PluginRecommendations, { rootPath: nextRoot() });
    await other.findByText('Reading List');
  });

  it('Settings → Plugins lists the recommendations, dismissed ones included', async () => {
    const tb = nextRoot();
    const card = render(PluginRecommendations, { rootPath: tb });
    await fireEvent.click(await card.findByRole('button', { name: 'Don\'t show again' }));
    cleanup();
    const { findByRole, getByText } = render(PluginsSettings);
    expect(await findByRole('list', { name: 'Recommended by this thoughtbase' })).toBeTruthy();
    expect(getByText('Get it from https://example.org/how-to-get-paper')).toBeTruthy();
    const install = getByText('Install', { selector: 'button' }) as HTMLButtonElement;
    await waitFor(() => expect(install.disabled).toBe(false));
    await fireEvent.click(install);
    await waitFor(() => expect(h.installGit).toHaveBeenCalledWith('https://github.com/ada/reading-list#v1'));
  });
});
