import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { executeNotebaseTool } from '../../../src/main/llm/tools';
import * as store from '../../../src/main/embeddings/vector-store';
import type { ChunkEmbedder } from '../../../src/main/embeddings/vector-store';
import { MODEL } from '../../../src/main/embeddings/embedder';
import { projectContext } from '../../../src/main/project-context-types';
import { useTempDir } from '../../helpers/temp-project';

/** Deterministic bag-of-words hashing embedder — shared words → higher cosine. */
function fakeEmbedder(): ChunkEmbedder {
  return {
    dim: MODEL.dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((t) => {
        const v = new Float32Array(MODEL.dim);
        for (const w of t.toLowerCase().split(/\W+/).filter(Boolean)) {
          let h = 0;
          for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % MODEL.dim] += 1;
        }
        const n = Math.hypot(...v);
        if (n > 0) for (let i = 0; i < MODEL.dim; i++) v[i] /= n;
        return v;
      });
    },
  };
}

describe('search_related tool (#837)', () => {
  const project = useTempDir('minerva-search-related-');
  const ctx = () => projectContext(project.root);

  afterEach(async () => {
    await store.dispose(ctx());
  });

  async function seed(): Promise<void> {
    await store.init(ctx(), { dbPath: path.join(project.root, '.minerva', 'vectors.duckdb'), embedder: fakeEmbedder() });
    await store.indexNote(ctx(), 'cats.md', '# Cats\nCats are feline animals that purr and hunt mice.');
    await store.indexNote(ctx(), 'dogs.md', '# Dogs\nDogs are canine animals that bark and fetch.');
    await store.indexNote(ctx(), 'finance.md', '# Finance\nQuarterly revenue and earnings reports for shareholders.');
  }

  it('returns a clear message when embeddings are not initialized', async () => {
    const out = await executeNotebaseTool({ rootPath: project.root }, 'search_related', { query: 'anything' });
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/not available|not initialized/i);
  });

  it('ranks semantically related notes for a free-text query', async () => {
    await seed();
    const out = await executeNotebaseTool({ rootPath: project.root }, 'search_related', {
      query: 'feline animals that purr',
      limit: 3,
    });
    expect(out.isError).toBe(false);
    expect(out.content).toContain('cats.md');
    // The cat note ranks first; a similarity score is shown.
    expect(out.content).toMatch(/cats\.md.*similarity \d/s);
    expect(out.content.indexOf('cats.md')).toBeLessThan(
      out.content.indexOf('finance.md') === -1 ? Infinity : out.content.indexOf('finance.md'),
    );
  });

  it('finds notes related to a given note, excluding the note itself', async () => {
    await seed();
    const out = await executeNotebaseTool({ rootPath: project.root }, 'search_related', {
      relative_path: 'cats.md',
    });
    expect(out.isError).toBe(false);
    // Its own path must not appear; the other animal note should rank above finance.
    expect(out.content).not.toContain('cats.md');
    expect(out.content).toContain('dogs.md');
  });

  it('de-dups multiple chunk hits from one note to a single best row', async () => {
    await store.init(ctx(), { dbPath: path.join(project.root, '.minerva', 'vectors.duckdb'), embedder: fakeEmbedder() });
    // A note with several sections all about the same topic.
    await store.indexNote(ctx(), 'multi.md', '# T\n\n## A\ngardening soil plants\n\n## B\ngardening soil plants\n\n## C\ngardening soil plants');
    const out = await executeNotebaseTool({ rootPath: project.root }, 'search_related', { query: 'gardening soil plants' });
    const occurrences = out.content.split('multi.md').length - 1;
    expect(occurrences).toBe(1);
  });

  it('errors when neither query nor relative_path is provided', async () => {
    await seed();
    const out = await executeNotebaseTool({ rootPath: project.root }, 'search_related', {});
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/query|relative_path/);
  });
});
