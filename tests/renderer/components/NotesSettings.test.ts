/**
 * @vitest-environment happy-dom
 *
 * Render coverage for NotesSettings (#2107) — extracted from SettingsDialog's
 * inline "notes" tab body. Covers the Refactor extraction destination fields
 * (per-change through the refactor-settings write-through helper, same
 * pattern as BehaviorsSettings/VersioningSettings) and the excerpt-note
 * default destination folder (async-loaded on mount, saved through the
 * settings store).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  api: {
    sources: {
      getExcerptNoteFolder: vi.fn(),
    },
  },
  settings: {
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

import NotesSettings from '../../../src/renderer/lib/components/NotesSettings.svelte';

beforeEach(() => {
  h.api.sources.getExcerptNoteFolder.mockResolvedValue('');
  h.settings.setExcerptNoteFolder.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('NotesSettings (#2107)', () => {
  it('renders the refactoring form and loads the excerpt folder on mount', async () => {
    h.api.sources.getExcerptNoteFolder.mockResolvedValue('excerpts');
    render(NotesSettings);

    expect(screen.getByLabelText('Destination for new notes')).toBeTruthy();
    expect(screen.getByLabelText('Filename prefix')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Default destination folder').value).toBe('excerpts'),
    );
  });

  it('reveals the custom template field only when destination is custom', async () => {
    render(NotesSettings);
    const destination = screen.getByLabelText('Destination for new notes');
    expect(screen.queryByLabelText('Custom folder template')).toBeNull();

    await fireEvent.change(destination, { target: { value: 'custom' } });
    // Persisted through the refactor-settings write-through helper…
    expect(h.setRefactorSettings).toHaveBeenCalledWith({ destination: 'custom' });
    // …and the conditional custom-template field now appears.
    expect(screen.getByLabelText('Custom folder template')).toBeTruthy();
  });

  it('persists the excerpt-note folder through the settings store on change', async () => {
    render(NotesSettings);
    await waitFor(() => expect(h.api.sources.getExcerptNoteFolder).toHaveBeenCalled());

    const folder = screen.getByLabelText('Default destination folder');
    await fireEvent.change(folder, { target: { value: 'inbox/excerpts' } });
    expect(h.settings.setExcerptNoteFolder).toHaveBeenCalledWith('inbox/excerpts');
  });
});
