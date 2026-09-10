/**
 * @vitest-environment happy-dom
 *
 * Object-types store (#2069): a type-definition proposal is approved through
 * the Proposals panel, not through this store's own `save()` — so without a
 * subscription to `api.proposals.onChanged`, an approved type would show
 * stale data in Settings/pickers until some unrelated mutation happened to
 * refresh it. Mirrors `stores/proposals.svelte.ts`'s own subscription.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listMock, noteTypeMapMock, onChangedCallbacks } = vi.hoisted(() => ({
  listMock: vi.fn(),
  noteTypeMapMock: vi.fn(),
  onChangedCallbacks: [] as Array<() => void>,
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    types: { list: listMock, noteTypeMap: noteTypeMapMock },
    proposals: {
      onChanged: (cb: () => void) => { onChangedCallbacks.push(cb); return () => {}; },
    },
  },
}));

import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const TYPE = { id: 'book', label: 'Book', classLocalName: 'Book', icon: '📖', source: 'stock' as const, properties: [] };

beforeEach(() => {
  listMock.mockReset();
  noteTypeMapMock.mockReset();
  listMock.mockResolvedValue({ types: [TYPE], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
});

describe('objectTypesStore — proposals-driven refresh (#2069)', () => {
  it('subscribed to api.proposals.onChanged at module init', () => {
    expect(onChangedCallbacks.length).toBeGreaterThan(0);
  });

  it('refreshes the catalog when a proposal changes (e.g. a type-def approval)', async () => {
    await objectTypesStore.refresh();
    expect(listMock).toHaveBeenCalledTimes(1);

    const RECIPE = { id: 'recipe', label: 'Recipe', classLocalName: 'Recipe', icon: '🍲', source: 'user' as const, properties: [] };
    listMock.mockResolvedValue({ types: [TYPE, RECIPE], errors: [] });

    onChangedCallbacks.forEach((cb) => cb());
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget refresh() settle

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(objectTypesStore.types.map((t) => t.id)).toEqual(['book', 'recipe']);
  });
});
