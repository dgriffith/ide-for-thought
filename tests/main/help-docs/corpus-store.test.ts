import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getHelpDocsCorpus, resetHelpDocsCorpusCache } from '../../../src/main/help-docs/corpus-store';
import { MODEL } from '../../../src/main/embeddings/embedder';

let dir: string;

function writeCorpus(contents: unknown): void {
  fs.mkdirSync(path.join(dir, 'help-docs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'help-docs', 'corpus.json'),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  );
}

const chunk = (id: string) => ({
  id,
  sourcePage: 'notes.html',
  pageTitle: 'Notes',
  heading: 'Overview',
  text: 'Some help text.',
  vector: [0, 0, 0],
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-help-docs-'));
  resetHelpDocsCorpusCache();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  resetHelpDocsCorpusCache();
});

describe('corpus-store', () => {
  it('loads a valid corpus matching the shipped embedding model', () => {
    writeCorpus({
      model: MODEL.name,
      dim: MODEL.dim,
      generatedAt: '2026-01-01T00:00:00.000Z',
      chunks: [chunk('notes.html'), chunk('notes.html#links')],
    });

    const chunks = getHelpDocsCorpus(dir);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.id).toBe('notes.html');
  });

  it('returns [] without throwing when the corpus file is missing', () => {
    expect(getHelpDocsCorpus(dir)).toEqual([]);
  });

  it('returns [] without throwing when the corpus file is malformed JSON', () => {
    writeCorpus('{ not valid json');
    expect(getHelpDocsCorpus(dir)).toEqual([]);
  });

  it('returns [] and ignores a corpus built against a different embedding model', () => {
    writeCorpus({
      model: 'some-other-model',
      dim: 123,
      generatedAt: '2026-01-01T00:00:00.000Z',
      chunks: [chunk('notes.html')],
    });

    expect(getHelpDocsCorpus(dir)).toEqual([]);
  });

  it('caches the loaded corpus across calls until reset', () => {
    writeCorpus({
      model: MODEL.name,
      dim: MODEL.dim,
      generatedAt: '2026-01-01T00:00:00.000Z',
      chunks: [chunk('notes.html')],
    });

    expect(getHelpDocsCorpus(dir)).toHaveLength(1);

    // Overwriting the file on disk shouldn't matter — the cache should win.
    writeCorpus({
      model: MODEL.name,
      dim: MODEL.dim,
      generatedAt: '2026-01-01T00:00:00.000Z',
      chunks: [chunk('notes.html'), chunk('notes.html#links')],
    });
    expect(getHelpDocsCorpus(dir)).toHaveLength(1);

    resetHelpDocsCorpusCache();
    expect(getHelpDocsCorpus(dir)).toHaveLength(2);
  });
});
