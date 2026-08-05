/**
 * The shared nav-history recorder behind every programmatic note open
 * (create-note, merge, safe-delete, and the note-creation paths). Mocks the
 * editor store; uses the real navigation singleton.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const editor = {
    activeTab: null as { type: string; id?: string; sourceId?: string } | null,
    activeFilePath: null as string | null,
    openFile: vi.fn(),
  };
  return { editor };
});
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));

import { openNoteRecordingHistory } from '../../../src/renderer/lib/app/nav-record';
import { getNavigationStore } from '../../../src/renderer/lib/stores/navigation.svelte';

const nav = getNavigationStore();

beforeEach(() => {
  vi.clearAllMocks();
  nav.clear();
  nav.doneNavigating();
  h.editor.openFile.mockResolvedValue(undefined);
  h.editor.activeTab = null;
  h.editor.activeFilePath = null;
});

describe('openNoteRecordingHistory (#1446)', () => {
  it('opens the target and records the current note so Back returns to it (with its caret offset)', async () => {
    h.editor.activeTab = { type: 'note' };
    h.editor.activeFilePath = 'a.md';
    await openNoteRecordingHistory('b.md', () => 42);
    expect(h.editor.openFile).toHaveBeenCalledWith('b.md');
    expect(nav.goBack()).toEqual({ type: 'note', relativePath: 'a.md', offset: 42 });
  });

  it('records a source from-position — creating a note from a source view returns Back to the source', async () => {
    h.editor.activeTab = { type: 'source', sourceId: 'url-abc' };
    await openNoteRecordingHistory('b.md', () => undefined);
    expect(nav.goBack()).toEqual({ type: 'source', sourceId: 'url-abc' });
  });

  it('records a query from-position', async () => {
    h.editor.activeTab = { type: 'query', id: 'q1' };
    await openNoteRecordingHistory('b.md', () => 0);
    expect(nav.goBack()).toEqual({ type: 'query', tabId: 'q1' });
  });

  it('never records the from-position when it is the note being deleted (merge source)', async () => {
    h.editor.activeTab = { type: 'note' };
    h.editor.activeFilePath = 'src.md';
    await openNoteRecordingHistory('target.md', () => 0, { excludeCurrent: 'src.md' });
    expect(nav.canGoBack).toBe(false);
  });

  it('skips recording when the current note is already the destination', async () => {
    h.editor.activeTab = { type: 'note' };
    h.editor.activeFilePath = 'same.md';
    await openNoteRecordingHistory('same.md', () => 0);
    expect(nav.canGoBack).toBe(false);
  });

  it('records only the destination when there is no recordable tab', async () => {
    h.editor.activeTab = null;
    await openNoteRecordingHistory('b.md', () => 0);
    expect(h.editor.openFile).toHaveBeenCalledWith('b.md');
    expect(nav.canGoBack).toBe(false);
  });
});
