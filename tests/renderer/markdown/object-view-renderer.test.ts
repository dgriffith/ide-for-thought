/**
 * @vitest-environment happy-dom
 *
 * Live Typed-Objects view embedded in a note (#2067). Hydration mounts a
 * real, chromeless `TypeView` into the placeholder — mocked here the same
 * way `TypeView.test.ts` mocks `api.types.instances`, since this exercises
 * the actual mount/unmount lifecycle, not a stubbed component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/svelte';

const { instancesMock, listMock, noteTypeMapMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(),
  listMock: vi.fn(),
  noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
}));

import { hydrateObjectViewBlocks, parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';
import type { ChartHandle } from '../../../src/renderer/lib/charts';

const TYPE = {
  id: 'book',
  label: 'Book',
  classLocalName: 'Book',
  icon: '📖',
  source: 'stock' as const,
  properties: [{ name: 'author', type: 'text' as const, label: 'Author' }],
};
const INSTANCES = [{ path: 'Dune.md', title: 'Dune', values: { author: 'Frank Herbert' }, cover: null }];

/** A `.preview`-alike root holding one unrendered object-view placeholder. */
function previewWith(specText: string): HTMLElement {
  const root = document.createElement('div');
  const block = document.createElement('div');
  block.className = 'object-view-block';
  block.textContent = specText;
  root.appendChild(block);
  document.body.appendChild(root);
  return root;
}

function deps(over: Partial<Parameters<typeof hydrateObjectViewBlocks>[1]> = {}) {
  const activeViews: ChartHandle[] = [];
  return { revision: 0, onOpenNote: vi.fn(), activeViews, ...over };
}

beforeEach(async () => {
  instancesMock.mockResolvedValue({ type: TYPE, instances: INSTANCES });
  listMock.mockResolvedValue({ types: [TYPE], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  await objectTypesStore.refresh();
});

afterEach(() => {
  document.body.innerHTML = '';
  instancesMock.mockReset();
});

describe('parseObjectViewSpec (#2067)', () => {
  it('parses a minimal valid spec, defaulting sort/columns', () => {
    expect(parseObjectViewSpec('{"typeId":"book","layout":"list"}')).toEqual({
      typeId: 'book',
      layout: 'list',
      sortColumn: null,
      sortDir: 'asc',
      columns: null,
    });
  });

  it('carries through explicit sort/columns', () => {
    expect(parseObjectViewSpec('{"typeId":"book","layout":"table","sortColumn":"author","sortDir":"desc","columns":["author"]}'))
      .toEqual({ typeId: 'book', layout: 'table', sortColumn: 'author', sortDir: 'desc', columns: ['author'] });
  });

  it('throws on malformed JSON', () => {
    expect(() => parseObjectViewSpec('{not json')).toThrow();
  });

  it('throws when typeId is missing', () => {
    expect(() => parseObjectViewSpec('{"layout":"list"}')).toThrow(/typeId/);
  });

  it('throws when layout is missing or invalid', () => {
    expect(() => parseObjectViewSpec('{"typeId":"book"}')).toThrow(/layout/);
    expect(() => parseObjectViewSpec('{"typeId":"book","layout":"chart"}')).toThrow(/layout/);
  });
});

describe('hydrateObjectViewBlocks (#2067)', () => {
  it('mounts a chromeless TypeView for a valid spec', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    hydrateObjectViewBlocks(root, deps());

    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.getAttribute('data-object-view-rendered')).toBe('ok'));
    await waitFor(() => expect(block.textContent).toContain('Dune'));
    // Chromeless: no header/switcher chrome leaked into the note.
    expect(block.querySelector('.tv-header')).toBeNull();
  });

  it('opens a note via the provided onOpenNote when a row is clicked', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    const onOpenNote = vi.fn();
    hydrateObjectViewBlocks(root, deps({ onOpenNote }));

    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.textContent).toContain('Dune'));
    (block.querySelector('.tv-list-row') as HTMLElement).click();
    expect(onOpenNote).toHaveBeenCalledWith('Dune.md');
  });

  it('renders a clear inline error for malformed JSON, not a blank block', () => {
    const root = previewWith('{not json');
    hydrateObjectViewBlocks(root, deps());

    const block = root.querySelector('.object-view-block')!;
    expect(block.getAttribute('data-object-view-rendered')).toBe('error');
    expect(block.querySelector('.object-view-error')).not.toBeNull();
  });

  it('renders a clear inline error for an invalid layout', () => {
    const root = previewWith('{"typeId":"book","layout":"pie-chart"}');
    hydrateObjectViewBlocks(root, deps());

    const block = root.querySelector('.object-view-block')!;
    expect(block.getAttribute('data-object-view-rendered')).toBe('error');
    expect(block.textContent).toMatch(/layout/);
  });

  it('is idempotent — does not re-mount an already-rendered block', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    hydrateObjectViewBlocks(root, deps());
    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.getAttribute('data-object-view-rendered')).toBe('ok'));

    instancesMock.mockClear();
    hydrateObjectViewBlocks(root, deps());
    expect(instancesMock).not.toHaveBeenCalled();
  });

  it('pushes a destroy handle onto activeViews for cleanup', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    const d = deps();
    hydrateObjectViewBlocks(root, d);
    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.getAttribute('data-object-view-rendered')).toBe('ok'));

    expect(d.activeViews).toHaveLength(1);
    expect(() => d.activeViews[0]!.destroy()).not.toThrow();
  });
});
