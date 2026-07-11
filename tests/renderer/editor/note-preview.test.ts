/**
 * Shared wiki-link preview fetcher (#1131 / #1132). Pins resolution, snippet
 * extraction (opening vs `#heading` section), the title source order, quiet
 * not-found, and the per-path read cache.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeNotePreviewFetcher, type NotePreviewDeps } from '../../../src/renderer/lib/editor/note-preview';

const NOTES: Record<string, string> = {
  'notes/topic.md': [
    '---',
    'title: The Topic',
    '---',
    '',
    '# The Topic',
    '',
    'Opening paragraph explaining the topic.',
    '',
    '## Section A',
    '',
    'Details about section A.',
  ].join('\n'),
  'notes/plain.md': '# Plain Note\n\nJust an H1 and a line.',
};

function makeDeps(overrides: Partial<NotePreviewDeps> = {}): { deps: NotePreviewDeps; read: ReturnType<typeof vi.fn> } {
  const read = vi.fn((p: string) => {
    const c = NOTES[p];
    return c !== undefined ? Promise.resolve(c) : Promise.reject(new Error('ENOENT'));
  });
  return {
    read,
    deps: {
      getNotePaths: () => Object.keys(NOTES),
      readNote: read,
      ...overrides,
    },
  };
}

describe('makeNotePreviewFetcher (#1131/#1132)', () => {
  it('previews a note: title + opening snippet (leading H1 dropped)', async () => {
    const { deps } = makeDeps();
    const preview = await makeNotePreviewFetcher(deps)('notes/topic');
    expect(preview).not.toBeNull();
    expect(preview!.path).toBe('notes/topic.md');
    expect(preview!.title).toBe('The Topic'); // from frontmatter
    expect(preview!.snippet).toContain('Opening paragraph');
    expect(preview!.snippet.startsWith('# ')).toBe(false); // H1 duplicate stripped
  });

  it('previews the referenced #heading section, not the whole note', async () => {
    const { deps } = makeDeps();
    const preview = await makeNotePreviewFetcher(deps)('notes/topic#Section A');
    expect(preview!.snippet).toContain('Details about section A');
    expect(preview!.snippet).not.toContain('Opening paragraph');
  });

  it('falls back to the H1 for the title when there is no frontmatter title', async () => {
    const { deps } = makeDeps();
    const preview = await makeNotePreviewFetcher(deps)('notes/plain');
    expect(preview!.title).toBe('Plain Note');
  });

  it('returns null for an unresolved target (quiet not-found)', async () => {
    const { deps } = makeDeps();
    expect(await makeNotePreviewFetcher(deps)('notes/ghost')).toBeNull();
  });

  it('caches the read — repeated hovers do not re-hit IPC', async () => {
    const { deps, read } = makeDeps();
    const fetch = makeNotePreviewFetcher(deps);
    await fetch('notes/topic');
    await fetch('notes/topic#Section A');
    await fetch('notes/topic');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
