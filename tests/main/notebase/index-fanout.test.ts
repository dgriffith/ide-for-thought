/**
 * `src/main/notebase/index-fanout.ts` — the shared graph/search/vectors
 * fan-out (#1892, #1985), tested directly rather than only through the
 * callers that route to it (`ipc/helpers.ts`, `window-manager.ts`,
 * `register-notebase.ts`'s rename/merge handlers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  graphIndexNote: vi.fn().mockResolvedValue({}),
  graphRemoveNote: vi.fn(),
  searchIndexNote: vi.fn(),
  searchRemoveNote: vi.fn(),
  vectorsIndexNote: vi.fn().mockResolvedValue(undefined),
  vectorsRemoveNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/main/graph/index', () => ({
  indexNote: h.graphIndexNote,
  removeNote: h.graphRemoveNote,
}));
vi.mock('../../../src/main/search/index', () => ({
  indexNote: h.searchIndexNote,
  removeNote: h.searchRemoveNote,
}));
vi.mock('../../../src/main/embeddings/vector-store', () => ({
  indexNote: h.vectorsIndexNote,
  removeNote: h.vectorsRemoveNote,
}));

import {
  indexAllFor,
  removeAllFor,
  indexSearchAndVectorsFor,
  removeSearchAndVectorsFor,
} from '../../../src/main/notebase/index-fanout';

const CTX = { rootPath: '/vault', _brand: 'ProjectContext' as const };

beforeEach(() => { vi.clearAllMocks(); });

describe('indexAllFor', () => {
  it('sends a markdown note to graph, search, and vectors', async () => {
    await indexAllFor(CTX, 'notes/a.md', '# hello');
    expect(h.graphIndexNote).toHaveBeenCalledWith(CTX, 'notes/a.md', '# hello');
    expect(h.searchIndexNote).toHaveBeenCalledWith(CTX, 'notes/a.md', '# hello');
    expect(h.vectorsIndexNote).toHaveBeenCalledWith(CTX, 'notes/a.md', '# hello');
  });

  it.each(['data/t.ttl', 'data/t.csv', 'scripts/t.py'])(
    'sends a non-markdown note (%s) to the graph only',
    async (rel) => {
      await indexAllFor(CTX, rel, 'content');
      expect(h.graphIndexNote).toHaveBeenCalled();
      expect(h.searchIndexNote).not.toHaveBeenCalled();
      expect(h.vectorsIndexNote).not.toHaveBeenCalled();
    },
  );
});

describe('removeAllFor', () => {
  it('removes a note from graph, search, and vectors unconditionally', () => {
    removeAllFor(CTX, 'data/t.ttl');
    expect(h.graphRemoveNote).toHaveBeenCalledWith(CTX, 'data/t.ttl');
    expect(h.searchRemoveNote).toHaveBeenCalledWith(CTX, 'data/t.ttl');
    expect(h.vectorsRemoveNote).toHaveBeenCalledWith(CTX, 'data/t.ttl');
  });
});

// The search+vectors-only half, used by the rename/merge reindexHook/removeHook
// callbacks that already index the note into the graph themselves (#1985).
describe('indexSearchAndVectorsFor', () => {
  it('indexes a markdown note into search and vectors, not the graph', () => {
    indexSearchAndVectorsFor(CTX, 'notes/a.md', 'body');
    expect(h.searchIndexNote).toHaveBeenCalledWith(CTX, 'notes/a.md', 'body');
    expect(h.vectorsIndexNote).toHaveBeenCalledWith(CTX, 'notes/a.md', 'body');
    expect(h.graphIndexNote).not.toHaveBeenCalled();
  });

  it('skips a non-markdown note entirely', () => {
    indexSearchAndVectorsFor(CTX, 'data/t.csv', 'a,b');
    expect(h.searchIndexNote).not.toHaveBeenCalled();
    expect(h.vectorsIndexNote).not.toHaveBeenCalled();
  });
});

describe('removeSearchAndVectorsFor', () => {
  it('removes a note from search and vectors, not the graph', () => {
    removeSearchAndVectorsFor(CTX, 'notes/a.md');
    expect(h.searchRemoveNote).toHaveBeenCalledWith(CTX, 'notes/a.md');
    expect(h.vectorsRemoveNote).toHaveBeenCalledWith(CTX, 'notes/a.md');
    expect(h.graphRemoveNote).not.toHaveBeenCalled();
  });
});
