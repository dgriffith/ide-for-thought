/**
 * Unit coverage for the shared source-actions module (#995) — the
 * rename/delete/tag helpers SourceDetail and SourcesPanel both route through.
 * Mocks the api client; uses the real displaySourceTitle. Verifies the confirm
 * copy, the no-op guards, the onDone refresh seam, and error swallowing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  api: {
    sources: { setTitle: vi.fn(), delete: vi.fn(), addTag: vi.fn() },
    tags: { list: vi.fn() },
  },
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import {
  renameSource,
  deleteSource,
  addSourceTag,
  sourceTagSuggestions,
} from '../../../src/renderer/lib/sources/source-actions';
import type { SourceMetadata } from '../../../src/shared/types';

const source = { sourceId: 's1', title: 'My Source', uri: null, doi: null, tags: ['keep'] } as unknown as SourceMetadata;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('renameSource', () => {
  it('sets the trimmed title and runs onDone when the name changes', async () => {
    const showPrompt = vi.fn().mockResolvedValue('  New Title  ');
    const onDone = vi.fn();
    await renameSource(source, showPrompt, onDone);
    expect(showPrompt).toHaveBeenCalledWith('Rename source:', 'My Source');
    expect(h.api.sources.setTitle).toHaveBeenCalledWith('s1', 'New Title');
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('is a no-op on a blank or unchanged name', async () => {
    const onDone = vi.fn();
    await renameSource(source, vi.fn().mockResolvedValue(null), onDone);
    await renameSource(source, vi.fn().mockResolvedValue('My Source'), onDone);
    expect(h.api.sources.setTitle).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('swallows + does not run onDone on API error', async () => {
    h.api.sources.setTitle.mockRejectedValueOnce(new Error('boom'));
    const onDone = vi.fn();
    await expect(renameSource(source, vi.fn().mockResolvedValue('X'), onDone)).resolves.toBeUndefined();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('deleteSource', () => {
  it('confirms with the canonical copy, deletes, then runs onDone', async () => {
    const showConfirm = vi.fn().mockResolvedValue(true);
    const onDone = vi.fn();
    const result = await deleteSource(source, showConfirm, onDone);
    expect(showConfirm).toHaveBeenCalledWith(
      'Delete source "My Source"? Any excerpts from this source will also be removed.',
      'delete-source',
      'Delete',
    );
    expect(h.api.sources.delete).toHaveBeenCalledWith('s1');
    expect(onDone).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('does nothing when the user cancels', async () => {
    const onDone = vi.fn();
    const result = await deleteSource(source, vi.fn().mockResolvedValue(false), onDone);
    expect(h.api.sources.delete).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

describe('addSourceTag', () => {
  it('adds a trimmed tag and runs onDone', async () => {
    const onDone = vi.fn();
    await addSourceTag('s1', '  topic  ', onDone);
    expect(h.api.sources.addTag).toHaveBeenCalledWith('s1', 'topic');
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('ignores a blank tag', async () => {
    const onDone = vi.fn();
    await addSourceTag('s1', '   ', onDone);
    expect(h.api.sources.addTag).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('swallows API errors', async () => {
    h.api.sources.addTag.mockRejectedValueOnce(new Error('boom'));
    await expect(addSourceTag('s1', 'topic')).resolves.toBeUndefined();
  });
});

describe('sourceTagSuggestions', () => {
  it('returns the vocabulary minus tags the source already carries', async () => {
    h.api.tags.list.mockResolvedValue([{ tag: 'keep' }, { tag: 'fresh' }, { tag: 'other' }]);
    expect(await sourceTagSuggestions(source)).toEqual(['fresh', 'other']);
  });

  it('tolerates a null source (offers the whole vocabulary)', async () => {
    h.api.tags.list.mockResolvedValue([{ tag: 'a' }, { tag: 'b' }]);
    expect(await sourceTagSuggestions(null)).toEqual(['a', 'b']);
  });

  it('returns [] on error', async () => {
    h.api.tags.list.mockRejectedValueOnce(new Error('boom'));
    expect(await sourceTagSuggestions(source)).toEqual([]);
  });
});
