/**
 * @vitest-environment happy-dom
 *
 * Right-sidebar TagsPanel interaction coverage (~0% before this). The panel
 * shows only the *active note's* tags: it loads the project-wide `TagInfo[]`
 * via `api.tags.list()` and intersects it with the tags parsed out of the
 * note's content (body `#hashtags` + frontmatter `tags:`). Clicking a leaf tag
 * fetches its notes/sources; clicking a parent (prefix) tag fetches the subtree.
 *
 * These tests render the real component against a mocked `api.tags` boundary and
 * assert the visible tree, the tagged-things list, the onFileSelect/onSourceSelect
 * callbacks, the search filter, and that content changes re-run the load. The
 * tag-tree helpers and the content tag-parser run for real; only IPC is stubbed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { TagInfo, TaggedNote, TaggedSource } from '../../../../src/shared/types';

const { listMock, notesByTagMock, sourcesByTagMock, notesByTagPrefixMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  notesByTagMock: vi.fn(),
  sourcesByTagMock: vi.fn(),
  notesByTagPrefixMock: vi.fn(),
}));

vi.mock('../../../../src/renderer/lib/ipc/client', () => ({
  api: {
    tags: {
      list: listMock,
      notesByTag: notesByTagMock,
      sourcesByTag: sourcesByTagMock,
      notesByTagPrefix: notesByTagPrefixMock,
    },
  },
}));

import TagsPanel from '../../../../src/renderer/lib/components/right-sidebar/TagsPanel.svelte';

afterEach(() => {
  cleanup();
  listMock.mockReset();
  notesByTagMock.mockReset();
  sourcesByTagMock.mockReset();
  notesByTagPrefixMock.mockReset();
});

/** Flat leaf/prefix tags: gamma is project-wide but NOT in the note. */
function flatTags(): TagInfo[] {
  return [
    { tag: 'alpha', noteCount: 3, sourceCount: 1 },
    { tag: 'beta', noteCount: 2, sourceCount: 0 },
    { tag: 'gamma', noteCount: 9, sourceCount: 0 },
  ];
}

/** Visible tag-name button labels, in DOM order, whitespace-stripped. */
function tagNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.tag-name')].map(
    (el) => (el.textContent ?? '').replace(/\s+/g, ''),
  );
}

function renderPanel(over: {
  content?: string;
  onFileSelect?: (p: string) => void;
  onSourceSelect?: (id: string) => void;
} = {}) {
  const onFileSelect = over.onFileSelect ?? vi.fn();
  const onSourceSelect = over.onSourceSelect ?? vi.fn();
  const utils = render(TagsPanel, {
    content: over.content ?? 'This note has #alpha and #beta tags.',
    onFileSelect,
    onSourceSelect,
  });
  return { ...utils, onFileSelect, onSourceSelect };
}

describe('right-sidebar TagsPanel', () => {
  it("renders only the active note's tags from api.tags.list (project-only tags filtered out)", async () => {
    listMock.mockResolvedValue(flatTags());
    const { container } = renderPanel();

    // alpha + beta are parsed from the note body; gamma is project-wide only.
    await waitFor(() => expect(tagNames(container)).toEqual(['#alpha', '#beta']));
    expect(tagNames(container)).not.toContain('#gamma');
  });

  it('shows the empty state when the note carries no tags', async () => {
    listMock.mockResolvedValue(flatTags());
    const { findByText } = renderPanel({ content: 'Plain prose with no tags at all.' });

    expect(await findByText('No tags in this note')).toBeTruthy();
  });

  it('clicking a leaf tag loads its notes + sources and routes clicks to the callbacks', async () => {
    listMock.mockResolvedValue(flatTags());
    notesByTagMock.mockResolvedValue([
      { title: 'Note One', relativePath: 'one.md' },
    ] as TaggedNote[]);
    sourcesByTagMock.mockResolvedValue([
      { title: 'Source One', sourceId: 's1' },
    ] as TaggedSource[]);

    const onFileSelect = vi.fn();
    const onSourceSelect = vi.fn();
    const { container, findByText } = renderPanel({ onFileSelect, onSourceSelect });

    await waitFor(() => expect(tagNames(container)).toContain('#alpha'));

    const alpha = [...container.querySelectorAll('.tag-name')].find(
      (el) => (el.textContent ?? '').replace(/\s+/g, '') === '#alpha',
    )!;
    await fireEvent.click(alpha);

    expect(notesByTagMock).toHaveBeenCalledWith('alpha');
    expect(sourcesByTagMock).toHaveBeenCalledWith('alpha');

    // The tagged-things list renders; clicking a note fires onFileSelect.
    await fireEvent.click(await findByText('Note One'));
    expect(onFileSelect).toHaveBeenCalledWith('one.md');

    // Clicking a tagged source fires onSourceSelect.
    await fireEvent.click(await findByText('Source One'));
    expect(onSourceSelect).toHaveBeenCalledWith('s1');
  });

  it('the search ribbon narrows the visible tags', async () => {
    listMock.mockResolvedValue(flatTags());
    const { container, getByPlaceholderText } = renderPanel();

    await waitFor(() => expect(tagNames(container)).toEqual(['#alpha', '#beta']));

    await fireEvent.input(getByPlaceholderText('Find tag…'), { target: { value: 'beta' } });
    expect(tagNames(container)).toEqual(['#beta']);
  });

  it('re-loads api.tags.list and re-derives the tree when the note content changes', async () => {
    listMock.mockResolvedValue(flatTags());
    const { container, rerender } = renderPanel({ content: 'only #alpha here' });

    await waitFor(() => expect(tagNames(container)).toEqual(['#alpha']));
    const callsAfterMount = listMock.mock.calls.length;

    // A save that swaps the note's tags re-runs refresh() and re-filters.
    await rerender({ content: 'now only #beta here', onFileSelect: vi.fn(), onSourceSelect: vi.fn() });

    await waitFor(() => expect(tagNames(container)).toEqual(['#beta']));
    expect(listMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('a parent (prefix) tag is collapsible and loads its subtree via notesByTagPrefix', async () => {
    listMock.mockResolvedValue([
      { tag: 'proj/a', noteCount: 1, sourceCount: 0 },
      { tag: 'proj/b', noteCount: 1, sourceCount: 0 },
    ] as TagInfo[]);
    notesByTagPrefixMock.mockResolvedValue([
      { title: 'Proj Note', relativePath: 'proj.md' },
    ] as TaggedNote[]);

    const { container, findByText, getByLabelText } = renderPanel({
      content: 'work on #proj/a and #proj/b',
    });

    // Collapsed by default: only the synthesized parent row is visible.
    await waitFor(() => expect(tagNames(container)).toEqual(['#proj/']));

    // Expanding the chevron reveals the two leaf children.
    await fireEvent.click(getByLabelText('Expand'));
    await waitFor(() => expect(tagNames(container)).toEqual(['#proj/', '#a', '#b']));

    // Clicking the parent tag loads the whole subtree via the prefix endpoint.
    const parent = [...container.querySelectorAll('.tag-name')].find(
      (el) => (el.textContent ?? '').replace(/\s+/g, '') === '#proj/',
    )!;
    await fireEvent.click(parent);

    expect(notesByTagPrefixMock).toHaveBeenCalledWith('proj');
    expect(await findByText('Proj Note')).toBeTruthy();
  });
});
