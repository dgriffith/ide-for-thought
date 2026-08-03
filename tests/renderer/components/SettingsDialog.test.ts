/**
 * @vitest-environment happy-dom
 *
 * SettingsDialog shell render test (#1600). SettingsDialog was refactored to
 * delegate each tab's body to an extracted panel child (Editor / Appearance /
 * Behaviors / … / AI / Skills), each with its own test. This exercises the
 * *shell*: the on-mount settings load, the grouped tab navigation + section
 * switching, the inline "Notes" (refactoring) panel that still lives in the
 * shell, and the Cancel / Done wiring to the settings store.
 *
 * Only light panels are mounted (Editor = prop-only, Web = bind-only, and the
 * inline Notes body), so no heavy child (AI / Skills / Compute) is pulled in —
 * keeps the shell test green and non-flaky.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  api: {
    tools: {
      getSettings: vi.fn(),
      getKeyStorage: vi.fn(),
      checkConnection: vi.fn(),
    },
    sources: {
      getExcerptNoteFolder: vi.fn(),
      getIngestSettings: vi.fn(),
    },
  },
  settings: {
    setToolSettings: vi.fn(),
    setIngestSettings: vi.fn(),
    setExcerptNoteFolder: vi.fn(),
  },
  refactor: {
    destination: 'same-folder' as const,
    destinationTemplate: '',
    filenamePrefix: '',
    normalizeHeadings: false,
    transcludeByDefault: false,
    linkTemplate: '',
    refactoredNoteTemplate: '',
  },
  setRefactorSettings: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/settings.svelte', () => ({
  getSettingsStore: () => h.settings,
}));
vi.mock('../../../src/renderer/lib/refactor/settings', () => ({
  getRefactorSettings: () => ({ ...h.refactor }),
  setRefactorSettings: h.setRefactorSettings,
}));

import SettingsDialog from '../../../src/renderer/lib/components/SettingsDialog.svelte';

function props(over: Record<string, unknown> = {}) {
  return {
    onApplyEditor: vi.fn(),
    onApplyFontSize: vi.fn(),
    onThemeChanged: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  h.api.tools.getSettings.mockResolvedValue({
    model: 'claude-opus-5',
    effort: undefined,
    providers: {},
    customModels: [],
    web: { enabled: true, allowedDomains: [], blockedDomains: [] },
    toolModelOverrides: {},
  });
  h.api.tools.getKeyStorage.mockResolvedValue({ available: false });
  h.api.sources.getExcerptNoteFolder.mockResolvedValue('');
  h.api.sources.getIngestSettings.mockResolvedValue({ importUpstreamTags: true });
  h.settings.setToolSettings.mockResolvedValue(undefined);
  h.settings.setIngestSettings.mockResolvedValue(undefined);
  h.settings.setExcerptNoteFolder.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SettingsDialog shell (#1600)', () => {
  it('renders the dialog and lands on the Editor tab, loading settings on mount', async () => {
    render(SettingsDialog, props());
    // Dialog chrome + default panel header (eyebrow group "Workspace" + title).
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Editor', level: 3 })).toBeTruthy();
    // "Workspace" shows both as the nav group label and the active panel eyebrow.
    expect(screen.getAllByText('Workspace').length).toBeGreaterThanOrEqual(1);
    // The Editor child panel is mounted (its "Word wrap" toggle is present).
    expect(screen.getByText('Word wrap')).toBeTruthy();
    // On-mount load reached the settings/ingest reads (getIngestSettings is the
    // last awaited call in onMount, so waiting on it flushes the whole chain).
    await waitFor(() => expect(h.api.sources.getIngestSettings).toHaveBeenCalled());
    expect(h.api.tools.getSettings).toHaveBeenCalled();
    expect(h.api.sources.getExcerptNoteFolder).toHaveBeenCalled();
  });

  it('renders all four settings groups with their tab labels', () => {
    render(SettingsDialog, props());
    for (const group of ['Workspace', 'Authoring', 'Ingest & compute', 'AI']) {
      // Group labels appear in the nav (and, for the active tab's group, as the
      // panel eyebrow too), so assert at least one match rather than exactly one.
      expect(screen.getAllByText(group).length).toBeGreaterThanOrEqual(1);
    }
    // A tab from a non-default group is present in the nav.
    expect(screen.getByRole('button', { name: /Bibliography/ })).toBeTruthy();
  });

  it('switches sections when a tab is clicked — Editor → Web mounts the Web panel', async () => {
    render(SettingsDialog, props());
    expect(screen.getByText('Word wrap')).toBeTruthy(); // editor panel first

    await fireEvent.click(screen.getByRole('button', { name: /Web/ }));

    // Web panel header + the Web child panel's own controls are now shown,
    // and the Editor panel is gone.
    expect(screen.getByRole('heading', { name: 'Web', level: 3 })).toBeTruthy();
    expect(screen.getByText('Allowed domains')).toBeTruthy();
    expect(screen.queryByText('Word wrap')).toBeNull();
  });

  it('shows the inline Notes (refactoring) panel and reveals the custom template field', async () => {
    render(SettingsDialog, props());
    await fireEvent.click(screen.getByRole('button', { name: /Notes/ }));

    // The refactoring form is rendered directly by the shell.
    const destination = screen.getByLabelText('Destination for new notes');
    expect(destination).toBeTruthy();
    expect(screen.getByLabelText('Filename prefix')).toBeTruthy();
    // Custom template field is hidden until "custom" is chosen.
    expect(screen.queryByLabelText('Custom folder template')).toBeNull();

    await fireEvent.change(destination, { target: { value: 'custom' } });
    // Persisted through the refactor-settings write-through helper…
    expect(h.setRefactorSettings).toHaveBeenCalledWith({ destination: 'custom' });
    // …and the conditional custom-template field now appears.
    expect(screen.getByLabelText('Custom folder template')).toBeTruthy();
  });

  it('honors initialTab by opening directly on that section', async () => {
    render(SettingsDialog, props({ initialTab: 'notes' }));
    // Lands on Notes without any click.
    expect(screen.getByRole('heading', { name: 'Notes', level: 3 })).toBeTruthy();
    expect(screen.getByLabelText('Destination for new notes')).toBeTruthy();
    expect(screen.queryByText('Word wrap')).toBeNull();
  });

  it('Cancel routes to onClose without persisting settings', async () => {
    const p = props();
    render(SettingsDialog, p);
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(h.settings.setToolSettings).not.toHaveBeenCalled();
  });

  it('Done persists editor + LLM + ingest settings through the store, then closes', async () => {
    const p = props();
    render(SettingsDialog, p);
    // Let onMount finish so handleDone builds the update from loaded state.
    await waitFor(() => expect(h.api.tools.getSettings).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // Editor settings applied via the host callback.
    await waitFor(() => expect(p.onApplyEditor).toHaveBeenCalledTimes(1));
    // LLM/tools settings saved through the settings store with the loaded model + web block.
    await waitFor(() => expect(h.settings.setToolSettings).toHaveBeenCalledTimes(1));
    const update = h.settings.setToolSettings.mock.calls[0]![0];
    expect(update.model).toBe('claude-opus-5');
    expect(update.web).toEqual({ enabled: true, allowedDomains: [], blockedDomains: [] });
    // Ingest settings persisted, then the dialog closes.
    expect(h.settings.setIngestSettings).toHaveBeenCalledWith({ importUpstreamTags: true });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});
