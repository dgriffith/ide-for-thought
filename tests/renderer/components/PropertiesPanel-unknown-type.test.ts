/**
 * @vitest-environment happy-dom
 *
 * A note whose `type:` no catalog defines (#2635) — usually a type from a
 * plugin that isn't in use here. The panel shows the id with a hint naming
 * the plugin the thoughtbase recommends, keeps the `type` row as written, and
 * changes nothing in the note.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import type { PluginRecommendation } from '../../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  api: {
    graph: { frontmatterKeys: vi.fn(), aliasMap: vi.fn() },
    notebase: { listFiles: vi.fn() },
    types: { noteProperties: vi.fn() },
  },
  notebase: {
    onRewritten: vi.fn(() => () => {}),
    onFileCreated: vi.fn(() => () => {}),
    onFileDeleted: vi.fn(() => () => {}),
  },
  recs: [] as PluginRecommendation[],
  openSettings: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => ({ showConfirm: vi.fn() }) }));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({
  objectTypesStore: { loaded: true, types: [{ id: 'book', label: 'Book' }], typeForNote: () => null },
}));
vi.mock('../../../src/renderer/lib/stores/feature-dialogs.svelte', () => ({ getFeatureDialogStore: () => ({ openSettings: h.openSettings }) }));
vi.mock('../../../src/renderer/lib/stores/plugins.svelte', () => ({
  getPluginsStore: () => ({
    recommendationsForType: (id: string) => {
      const exact = h.recs.find((r) => r.types.includes(id)) ?? null;
      return { exact, possible: exact ? [] : h.recs.filter((r) => r.types.length === 0) };
    },
  }),
}));

import PropertiesPanel from '../../../src/renderer/lib/components/right-sidebar/PropertiesPanel.svelte';

const note = (type: string) => `---\ntype: ${type}\nstatus: unread\n---\n# Dune\n`;
const props = (content: string) => ({ content, onContentChange: vi.fn(), onNavigate: vi.fn(), activeFilePath: 'Dune.md' });

beforeEach(() => {
  vi.clearAllMocks();
  h.api.graph.frontmatterKeys.mockResolvedValue([]);
  h.api.graph.aliasMap.mockResolvedValue({});
  h.api.notebase.listFiles.mockResolvedValue([]);
  h.api.types.noteProperties.mockResolvedValue({ type: null, properties: [] });
  h.recs = [];
});
afterEach(() => cleanup());

describe('PropertiesPanel — a type from a missing plugin (#2635)', () => {
  it('names the recommended plugin, and leaves the note alone', async () => {
    h.recs = [{ id: 'reading-list', name: 'Reading List', types: ['book-note'], status: 'missing' }];
    const p = props(note('book-note'));
    const { findByText, getByText, getByRole } = render(PropertiesPanel, p);
    expect(await findByText(/comes from the Reading List plugin/)).toBeTruthy();
    expect(getByText('book-note', { selector: '.label' })).toBeTruthy();
    await fireEvent.click(getByRole('button', { name: 'Plugins settings…' }));
    expect(h.openSettings).toHaveBeenCalledWith('plugins');
    expect(p.onContentChange).not.toHaveBeenCalled();
  });

  it('with no recommendation, still reads as a hint, not an error', async () => {
    const { findByText, queryByRole } = render(PropertiesPanel, props(note('sample')));
    expect(await findByText(/No type "sample" is defined here; it may come from a plugin/)).toBeTruthy();
    expect(queryByRole('button', { name: 'Plugins settings…' })).toBeNull();
  });

  it('says nothing for a type the catalog knows', async () => {
    const { container } = render(PropertiesPanel, props(note('Book')));
    expect(container.querySelector('.glyph')).toBeNull();
  });
});
