import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getHelpDocsCorpus, resetHelpDocsCorpusCache } from '../../../src/main/help-docs/corpus-store';
import { modelDir, MODEL } from '../../../src/main/embeddings/embedder';
import type { Embedder } from '../../../src/main/embeddings/embedder';

describe('searchHelpDocs (no corpus)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-help-search-empty-'));
    resetHelpDocsCorpusCache();
    // Prime the module-level cache to [] via the override, so searchHelpDocs's
    // own no-args getHelpDocsCorpus() call (it never threads an override
    // through) hits this cached empty result instead of falling through to
    // whatever real corpus.json happens to exist in this checkout's
    // resources/help-docs/ (e.g. already built by `pnpm fetch:help-corpus`).
    getHelpDocsCorpus(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    resetHelpDocsCorpusCache();
  });

  it('honestly degrades — empty hits, weakMatch true — without touching the embedder', async () => {
    const { searchHelpDocs } = await import('../../../src/main/help-docs/search');
    // No embedder is passed and none is stubbed — if the empty-corpus
    // short-circuit didn't fire, this would throw trying to spawn the
    // worker-backed shared embedder (no built embed-worker.js under vitest).
    const result = await searchHelpDocs('how do I make a link', 5);
    expect(result).toEqual({ hits: [], weakMatch: true });
  });
});

// Real model inference — needs the bundled weights staged by
// scripts/fetch-embedding-model.mjs. Skip (don't fail) when they're absent so a
// no-network checkout still passes the rest of the suite.
const haveModel = fs.existsSync(path.join(modelDir(), 'onnx', 'model_quantized.onnx'));
const d = haveModel ? describe : describe.skip;

d('searchHelpDocs (real embedder, synthetic corpus)', () => {
  let corpusDir: string;
  let embedder: Embedder;

  beforeAll(async () => {
    corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-help-search-synth-'));

    const { createWasmEmbedder } = await import('../../../src/main/embeddings/wasm-embedder');
    embedder = await createWasmEmbedder();

    const texts = [
      'Link a note to another with [[wikilink]] syntax to connect related ideas.',
      'The graph view shows notes as nodes and links as edges between them.',
      'Quarterly revenue and earnings reports exceeded analyst forecasts.',
    ];
    const vectors = await embedder.embed(texts);
    fs.mkdirSync(path.join(corpusDir, 'help-docs'), { recursive: true });
    fs.writeFileSync(
      path.join(corpusDir, 'help-docs', 'corpus.json'),
      JSON.stringify({
        model: MODEL.name,
        dim: MODEL.dim,
        generatedAt: '2026-01-01T00:00:00.000Z',
        chunks: [
          { id: 'notes-links.html', sourcePage: 'notes-links.html', pageTitle: 'Links', heading: 'Linking notes', text: texts[0], vector: Array.from(vectors[0]!) },
          { id: 'navigation-graph.html', sourcePage: 'navigation-graph.html', pageTitle: 'Graph view', heading: 'Graph view', text: texts[1], vector: Array.from(vectors[1]!) },
          { id: 'unrelated.html', sourcePage: 'unrelated.html', pageTitle: 'Unrelated', heading: 'Unrelated', text: texts[2], vector: Array.from(vectors[2]!) },
        ],
      }),
    );
  }, 60_000);
  afterAll(async () => {
    await embedder?.dispose();
    fs.rmSync(corpusDir, { recursive: true, force: true });
    resetHelpDocsCorpusCache();
  });

  // searchHelpDocs() calls getHelpDocsCorpus() with no override, relying on the
  // module cache — re-prime it before every test in this block, since other
  // test files (and the "no corpus" block above) reset/repopulate that same
  // process-wide cache.
  beforeEach(() => {
    resetHelpDocsCorpusCache();
    getHelpDocsCorpus(corpusDir);
  });

  it('ranks the semantically closest chunk first, with a confident (non-weak) match', async () => {
    const { searchHelpDocs } = await import('../../../src/main/help-docs/search');
    const { hits, weakMatch } = await searchHelpDocs('how do I link one note to another?', 2, embedder);

    expect(hits).toHaveLength(2);
    expect(hits[0]!.id).toBe('notes-links.html');
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(weakMatch).toBe(false);
  });

  it('flags weakMatch when the closest hit still scores below the threshold', async () => {
    const { searchHelpDocs, WEAK_MATCH_THRESHOLD } = await import('../../../src/main/help-docs/search');
    const { hits, weakMatch } = await searchHelpDocs('what is the boiling point of tungsten?', 1, embedder);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.score).toBeLessThan(WEAK_MATCH_THRESHOLD);
    expect(weakMatch).toBe(true);
  });
});
