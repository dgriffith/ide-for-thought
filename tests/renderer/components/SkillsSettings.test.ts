/**
 * @vitest-environment happy-dom
 *
 * Render coverage for SkillsSettings (#672) — the skills/menu-config panel
 * extracted from SettingsDialog. Mocks api.skills + the registry sync; the real
 * menu-config logic (placement / ordering / enable) runs. Pins the catalog
 * render, the enable toggle + menu reassignment → setMenuConfig, and the
 * import / remove / reload IPC.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { SkillInfo } from '../../../src/shared/skills/types';
import { emptyMenuConfig } from '../../../src/shared/skills/menu-config';

const {
  listMock, setMenuConfigMock, importMock, removeMock, reloadMock, revealMock, registerMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  setMenuConfigMock: vi.fn(),
  importMock: vi.fn(),
  removeMock: vi.fn(),
  reloadMock: vi.fn(),
  revealMock: vi.fn(),
  registerMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    skills: {
      list: listMock,
      setMenuConfig: setMenuConfigMock,
      import: importMock,
      remove: removeMock,
      reload: reloadMock,
      revealFolder: revealMock,
    },
  },
}));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ registerSkillInfos: registerMock }));

import SkillsSettings from '../../../src/renderer/lib/components/SkillsSettings.svelte';

function skill(over: Partial<SkillInfo> & Pick<SkillInfo, 'id' | 'name'>): SkillInfo {
  return {
    description: `${over.name} desc`,
    longDescription: '',
    menu: 'Learning',
    scope: 'note',
    outputMode: 'note',
    context: [],
    parameters: [],
    web: false,
    requiresSelection: false,
    source: 'stock',
    ...over,
  } as SkillInfo;
}

function catalog(skills: SkillInfo[], errors: { filePath: string; label: string; message: string }[] = []) {
  return { skills, errors, config: emptyMenuConfig() };
}

afterEach(() => {
  cleanup();
  [listMock, setMenuConfigMock, importMock, removeMock, reloadMock, revealMock, registerMock]
    .forEach((m) => m.mockReset());
});

describe('SkillsSettings (#672)', () => {
  it('loads the catalog on mount, renders skills under their menus, and syncs the registry', async () => {
    listMock.mockResolvedValue(catalog([
      skill({ id: 'a', name: 'Summarize', menu: 'Learning' }),
      skill({ id: 'b', name: 'Find Sources', menu: 'Research', source: 'user' }),
    ]));
    const { findByText, getByText, getAllByText } = render(SkillsSettings, {});
    expect(await findByText('Summarize')).toBeTruthy();
    expect(getByText('Find Sources')).toBeTruthy();
    // "Research" appears as a menu-section label (and as a <select> option).
    expect(getAllByText('Research').length).toBeGreaterThan(0);
    expect(registerMock).toHaveBeenCalled();
  });

  it('toggling a skill off persists a disabled entry via setMenuConfig', async () => {
    listMock.mockResolvedValue(catalog([skill({ id: 'a', name: 'Summarize', menu: 'Learning' })]));
    setMenuConfigMock.mockImplementation((cfg) => Promise.resolve(cfg));
    const { findByText, getAllByRole } = render(SkillsSettings, {});
    await findByText('Summarize');

    await fireEvent.click(getAllByRole('checkbox')[0]);
    await waitFor(() => expect(setMenuConfigMock).toHaveBeenCalled());
    const cfg = setMenuConfigMock.mock.calls[0][0];
    expect(cfg.skills.a.enabled).toBe(false);
  });

  it('reassigning a skill to another menu persists the new menu', async () => {
    listMock.mockResolvedValue(catalog([skill({ id: 'a', name: 'Summarize', menu: 'Learning' })]));
    setMenuConfigMock.mockImplementation((cfg) => Promise.resolve(cfg));
    const { findByText, getAllByRole } = render(SkillsSettings, {});
    await findByText('Summarize');

    await fireEvent.change(getAllByRole('combobox')[0], { target: { value: 'Analysis' } });
    await waitFor(() => expect(setMenuConfigMock).toHaveBeenCalled());
    expect(setMenuConfigMock.mock.calls[0][0].skills.a.menu).toBe('Analysis');
  });

  it('Import calls api.skills.import then refreshes the catalog', async () => {
    listMock.mockResolvedValue(catalog([]));
    importMock.mockResolvedValue(true);
    const { findByText, getByText } = render(SkillsSettings, {});
    await findByText('Skills');

    listMock.mockClear();
    await fireEvent.click(getByText('Import skill…'));
    await waitFor(() => expect(importMock).toHaveBeenCalled());
    await waitFor(() => expect(listMock).toHaveBeenCalled()); // reloaded
  });

  it('Remove (user skill) calls api.skills.remove with the id', async () => {
    listMock.mockResolvedValue(catalog([skill({ id: 'u1', name: 'My Skill', menu: 'Learning', source: 'user' })]));
    removeMock.mockResolvedValue(undefined);
    const { findByText, getByText } = render(SkillsSettings, {});
    await findByText('My Skill');

    await fireEvent.click(getByText('Remove'));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('u1'));
  });

  it('Reload calls api.skills.reload', async () => {
    listMock.mockResolvedValue(catalog([]));
    reloadMock.mockResolvedValue(catalog([]));
    const { findByText, getByText } = render(SkillsSettings, {});
    await findByText('Skills');
    await fireEvent.click(getByText('Reload'));
    await waitFor(() => expect(reloadMock).toHaveBeenCalled());
  });

  it('surfaces an import error in the banner', async () => {
    listMock.mockResolvedValue(catalog([]));
    importMock.mockRejectedValue(new Error('bad skill file'));
    const { findByText, getByText } = render(SkillsSettings, {});
    await findByText('Skills');
    await fireEvent.click(getByText('Import skill…'));
    expect(await findByText('bad skill file')).toBeTruthy();
  });

  it('lists skills that failed to load', async () => {
    listMock.mockResolvedValue(catalog([], [{ filePath: '/x/bad.md', label: 'bad', message: 'parse error' }]));
    const { findByText } = render(SkillsSettings, {});
    expect(await findByText(/parse error/)).toBeTruthy();
  });
});
