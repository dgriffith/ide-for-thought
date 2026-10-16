/**
 * @vitest-environment happy-dom
 *
 * Settings → Plugins (#2634), with its store: the list with what each
 * contributes, the refused ones, the toggle, Remove behind a confirm, install,
 * and — on `plugins:changed` — the skill registry and type list refreshed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { PluginList } from '../../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  list: vi.fn(), setEnabled: vi.fn(), remove: vi.fn(), installFolder: vi.fn(), installZip: vi.fn(), installGit: vi.fn(), reveal: vi.fn(),
  changed: null as null | (() => void),
  skillsList: vi.fn(), registerSkillInfos: vi.fn(), typesRefresh: vi.fn(), showConfirm: vi.fn(), showPrompt: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    plugins: {
      list: h.list, setEnabled: h.setEnabled, remove: h.remove, installFolder: h.installFolder, installZip: h.installZip, installGit: h.installGit, reveal: h.reveal,
      onChanged: (cb: () => void) => { h.changed = cb; return () => undefined; },
    },
    skills: { list: h.skillsList },
  },
}));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ registerSkillInfos: h.registerSkillInfos }));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({ objectTypesStore: { refresh: h.typesRefresh } }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => ({ showConfirm: h.showConfirm, showPrompt: h.showPrompt }) }));

import PluginsSettings from '../../../src/renderer/lib/components/PluginsSettings.svelte';

const LIST: PluginList = {
  installed: [{
    id: 'lab', name: 'Lab Tools', version: '1.2.0', description: 'For the lab', author: 'Ada', enabled: true,
    source: { kind: 'folder', path: '/work/lab' }, contributes: { skills: 2, 'object-types': 1 },
  }],
  errors: [{ folder: 'broken', label: 'broken', problems: ['It has no plugin.json.'] }],
  folder: '/home/u/.minerva/plugins',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.list.mockResolvedValue(LIST);
  h.setEnabled.mockResolvedValue({ ...LIST, installed: [{ ...LIST.installed[0]!, enabled: false }] });
  h.remove.mockResolvedValue({ ...LIST, installed: [] });
  h.skillsList.mockResolvedValue({ skills: [], errors: [], config: { overrides: {}, order: {}, disabled: [] } });
  h.typesRefresh.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('PluginsSettings (#2634)', () => {
  it('lists each plugin with what it contributes, and the refused with why', async () => {
    const { findByText, getByText } = render(PluginsSettings);
    await findByText('Lab Tools');
    expect(getByText('1.2.0')).toBeTruthy();
    expect(getByText('2 skills · 1 type')).toBeTruthy();
    expect(getByText('For the lab — Ada')).toBeTruthy();
    expect(getByText('It has no plugin.json.')).toBeTruthy();
    expect(getByText('From /work/lab')).toBeTruthy();
  });

  it('says where each plugin came from: a zip, a git URL at its commit, or by hand', async () => {
    const base = LIST.installed[0]!;
    h.list.mockResolvedValue({
      ...LIST,
      installed: [
        { ...base, id: 'a', name: 'A', source: { kind: 'zip', name: 'a.zip', sha256: 'f'.repeat(64) } },
        { ...base, id: 'b', name: 'B', source: { kind: 'git', url: 'https://github.com/ada/b', ref: 'v2.0.0', commit: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d' } },
        { ...base, id: 'c', name: 'C', source: { kind: 'manual' } },
      ],
    });
    const { findByText } = render(PluginsSettings);
    await findByText('From a.zip');
    await findByText('From https://github.com/ada/b #v2.0.0 at 7fd1a60');
    await findByText('Put in the plugins folder by hand');
  });

  it('the toggle turns a plugin off', async () => {
    const { findByRole } = render(PluginsSettings);
    const box = await findByRole('checkbox', { name: 'Turn off Lab Tools' }) as HTMLInputElement;
    await fireEvent.click(box);
    expect(h.setEnabled).toHaveBeenCalledWith('lab', false);
  });

  it('Remove asks first, saying the folder it came from is kept', async () => {
    h.showConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { findByRole, queryByText } = render(PluginsSettings);
    const btn = await findByRole('button', { name: 'Remove Lab Tools' });
    await fireEvent.click(btn);
    await waitFor(() => expect(h.showConfirm).toHaveBeenCalledTimes(1));
    expect(h.showConfirm.mock.calls[0]![0]).toMatch(/the folder you installed it from is kept/);
    expect(h.remove).not.toHaveBeenCalled();
    await fireEvent.click(btn);
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith('lab'));
    await waitFor(() => expect(queryByText('Lab Tools')).toBeNull());
  });

  it('Install from folder… installs, and the list follows', async () => {
    h.installFolder.mockResolvedValue({ id: 'lab', name: 'Lab Tools' });
    const { findByText } = render(PluginsSettings);
    await fireEvent.click(await findByText('Install from folder…'));
    await waitFor(() => expect(h.installFolder).toHaveBeenCalled());
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
  });

  it('Install from zip… installs, and the list follows', async () => {
    h.installZip.mockResolvedValue({ id: 'lab', name: 'Lab Tools' });
    const { findByText } = render(PluginsSettings);
    await fireEvent.click(await findByText('Install from zip…'));
    await waitFor(() => expect(h.installZip).toHaveBeenCalled());
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(2));
  });

  it('Install from git URL… asks for the URL, installs it; a cancelled prompt does nothing', async () => {
    h.showPrompt.mockResolvedValueOnce('  https://github.com/ada/lab#v1.0.0 ').mockResolvedValueOnce(null);
    h.installGit.mockResolvedValue({ id: 'lab', name: 'Lab Tools' });
    const { findByText } = render(PluginsSettings);
    const button = await findByText('Install from git URL…');
    await fireEvent.click(button);
    await waitFor(() => expect(h.installGit).toHaveBeenCalledWith('https://github.com/ada/lab#v1.0.0'));
    await fireEvent.click(button);
    await waitFor(() => expect(h.showPrompt).toHaveBeenCalledTimes(2));
    expect(h.installGit).toHaveBeenCalledTimes(1);
  });

  it('a refused install shows why', async () => {
    h.installFolder.mockRejectedValue(new Error('It can\'t be installed: it has no plugin.json.'));
    const { findByText, findByRole } = render(PluginsSettings);
    await fireEvent.click(await findByText('Install from folder…'));
    expect((await findByRole('alert')).textContent).toContain('can\'t be installed');
  });

  it('on plugins:changed — from anywhere — the skills and types are refreshed', async () => {
    render(PluginsSettings);
    await waitFor(() => expect(h.list).toHaveBeenCalled());
    h.changed!();
    await waitFor(() => expect(h.registerSkillInfos).toHaveBeenCalled());
    expect(h.typesRefresh).toHaveBeenCalled();
  });
});
