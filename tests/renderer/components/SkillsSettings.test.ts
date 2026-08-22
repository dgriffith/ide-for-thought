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
  listMock, confirmMock, setMenuConfigMock, importMock, removeMock, reloadMock, revealMock, registerMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  confirmMock: vi.fn(),
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
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: confirmMock, showPrompt: vi.fn() }),
}));

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

/** A skill row's own selects, found by class rather than by index — the panel
 *  also renders a panel-level provider select above the rows, so "the first
 *  combobox" stopped meaning "the first skill's menu picker". */
function menuSelect(container: HTMLElement): HTMLSelectElement {
  return container.querySelector('.skill-menu-select') as HTMLSelectElement;
}
function modelSelectFor(container: HTMLElement): HTMLSelectElement {
  return container.querySelector('.skill-model-select') as HTMLSelectElement;
}

afterEach(() => {
  cleanup();
  [listMock, confirmMock, setMenuConfigMock, importMock, removeMock, reloadMock, revealMock, registerMock]
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
    const { findByText, container } = render(SkillsSettings, {});
    await findByText('Summarize');

    await fireEvent.change(menuSelect(container), { target: { value: 'Analysis' } });
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

  it('renders a per-skill model override select whose default reflects the skill preference, and updates on change', async () => {
    listMock.mockResolvedValue(catalog([
      skill({ id: 'a', name: 'Summarize', menu: 'Learning', model: 'claude-opus-4-8' }),
    ]));
    const { findByText, container } = render(SkillsSettings, { toolModelOverrides: {} });
    await findByText('Summarize');

    // Per skill row: [0] menu (location) select, [1] model override select.
    const modelSelect = modelSelectFor(container);
    expect(modelSelect.value).toBe(''); // empty → use the skill's preferred model
    expect(modelSelect.options[0].textContent).toMatch(/Default · Claude Opus 4\.8/);

    await fireEvent.change(modelSelect, { target: { value: 'claude-haiku-4-5' } });
    expect(modelSelect.value).toBe('claude-haiku-4-5');
  });

  it('shows a plain "Default model" option when the skill has no preference and no global default is given', async () => {
    listMock.mockResolvedValue(catalog([skill({ id: 'a', name: 'Summarize', menu: 'Learning' })]));
    const { findByText, container } = render(SkillsSettings, { toolModelOverrides: {} });
    await findByText('Summarize');
    const modelSelect = modelSelectFor(container);
    expect(modelSelect.options[0].textContent).toBe('Default model');
  });

  it('names the global default model in the empty option when the skill has no preference', async () => {
    listMock.mockResolvedValue(catalog([skill({ id: 'a', name: 'Summarize', menu: 'Learning' })]));
    const { findByText, container } = render(SkillsSettings, {
      toolModelOverrides: {},
      defaultModel: 'claude-sonnet-4-6',
    });
    await findByText('Summarize');
    const modelSelect = modelSelectFor(container);
    expect(modelSelect.options[0].textContent).toBe('Default · Claude Sonnet 4.6');
  });

  it("prefers the skill's own model over the global default in the empty option", async () => {
    listMock.mockResolvedValue(catalog([
      skill({ id: 'a', name: 'Summarize', menu: 'Learning', model: 'claude-opus-4-8' }),
    ]));
    const { findByText, container } = render(SkillsSettings, {
      toolModelOverrides: {},
      defaultModel: 'claude-sonnet-4-6',
    });
    await findByText('Summarize');
    const modelSelect = modelSelectFor(container);
    expect(modelSelect.options[0].textContent).toBe('Default · Claude Opus 4.8');
  });
});

describe('SkillsSettings — Reset to Default (per provider)', () => {
  /** One heavy skill and one light one, so a reset has both tiers to place. */
  const TIERED = [
    skill({ id: 'deep', name: 'Antithesize', model: 'claude-opus-5' }),
    skill({ id: 'quick', name: 'Add Term', model: 'claude-sonnet-5' }),
  ];

  /** The rows' model pickers, in catalog order — what the panel actually shows
   *  for each skill after a reset. */
  function rowModels(container: HTMLElement): string[] {
    return [...container.querySelectorAll<HTMLSelectElement>('.skill-model-select')].map((el) => el.value);
  }

  async function openPanel(overrides: Record<string, string> = {}) {
    listMock.mockResolvedValue(catalog(TIERED));
    const rendered = render(SkillsSettings, {
      toolModelOverrides: overrides,
      defaultModel: 'claude-opus-5',
    });
    await rendered.findByText('Antithesize');
    return rendered;
  }

  it('carries each skill onto the matching tier of the chosen provider', async () => {
    confirmMock.mockResolvedValue(true);
    const { getByText, getByLabelText, container } = await openPanel();

    await fireEvent.change(getByLabelText('Provider to reset skill models to'), { target: { value: 'google' } });
    await fireEvent.click(getByText('Reset to Default…'));

    // The heavy skill keeps a frontier model; the light one stays cheap. That
    // judgement is the whole point — a blanket reset to one flagship would put
    // the mechanical skills on the expensive model.
    await waitFor(() => expect(rowModels(container)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash']));
  });

  it('clears every pin when resetting onto the provider the skills were authored for', async () => {
    confirmMock.mockResolvedValue(true);
    const { getByText, container } = await openPanel({ deep: 'gpt-5', quick: 'o4-mini' });
    expect(rowModels(container)).toEqual(['gpt-5', 'o4-mini']);

    await fireEvent.click(getByText('Reset to Default…'));

    // Empty = "use the skill's own preference", which is already right here —
    // so the panel returns to pristine rather than pinning redundant values.
    await waitFor(() => expect(rowModels(container)).toEqual(['', '']));
  });

  it('does nothing when the confirmation is declined', async () => {
    confirmMock.mockResolvedValue(false);
    const { getByText, getByLabelText, container } = await openPanel({ deep: 'gpt-5' });

    await fireEvent.change(getByLabelText('Provider to reset skill models to'), { target: { value: 'openai' } });
    await fireEvent.click(getByText('Reset to Default…'));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(rowModels(container)).toEqual(['gpt-5', '']);
  });

  it('names the provider in the confirmation, and promises menus are untouched', async () => {
    confirmMock.mockResolvedValue(false);
    const { getByText, getByLabelText } = await openPanel();

    await fireEvent.change(getByLabelText('Provider to reset skill models to'), { target: { value: 'openai' } });
    await fireEvent.click(getByText('Reset to Default…'));

    const [message] = confirmMock.mock.calls[0];
    expect(message).toContain('OpenAI');
    expect(message).toMatch(/menus, and ordering are untouched/);
  });

  it('leaves the menu config alone — resetting models is not a reset of everything', async () => {
    confirmMock.mockResolvedValue(true);
    const { getByText } = await openPanel();
    await fireEvent.click(getByText('Reset to Default…'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(setMenuConfigMock).not.toHaveBeenCalled();
  });
});
