/**
 * Similarity search over the help-docs corpus (#1285, epic:docs-grounding, #1154).
 *
 * Embeds the query with the same process-global embedder singleton the
 * thoughtbase's own semantic search uses (`shared-embedder.ts` — no second
 * model load) unless a caller injects its own (tests: the shared singleton is
 * worker-thread-backed and needs a built `embed-worker.js`, so tests pass a
 * directly-instantiated `createWasmEmbedder()` instead — same pattern as
 * `cli/engine.ts`'s `opts.embedder ?? getSharedEmbedder(...)`). Then
 * brute-force cosine-ranks it against the corpus loaded by `corpus-store.ts`.
 * Brute force is deliberate: at ~500 chunks (~230-460 KB of vectors) this is
 * sub-millisecond, and simpler than a second DuckDB instance for a corpus this
 * small, static, and read-only.
 *
 * `weakMatch` is the honest-degrade signal #1154 is actually about: a search
 * with no confidence signal (like `search-related.ts`'s tool) lets a bad
 * match get presented as if it were a good one. Here, the caller still gets
 * the closest hit(s) even when `weakMatch` is true — the point isn't to
 * withhold results, it's to tell the caller (ultimately the model) that they
 * shouldn't be trusted as a confident answer.
 */

import { getSharedEmbedder } from '../embeddings/shared-embedder';
import type { EmbedderService } from '../embeddings/embedder-service';
import { cosineSimilarity } from '../embeddings/pooling';
import { getHelpDocsCorpus } from './corpus-store';

export interface HelpHit {
  id: string;
  sourcePage: string;
  pageTitle: string;
  heading: string;
  text: string;
  score: number;
}

export interface HelpSearchResult {
  hits: HelpHit[];
  weakMatch: boolean;
}

/**
 * Cosine-similarity floor below which even the best hit shouldn't be
 * presented as a confident answer. A starting estimate (not yet tuned
 * against real query traffic against the real corpus — see #1287): a quick
 * manual check found genuinely out-of-scope queries scoring ~0.29-0.32
 * against this corpus, and genuinely in-scope ones ~0.43-0.63, so 0.35 sits
 * in the gap between them.
 */
export const WEAK_MATCH_THRESHOLD = 0.35;

export async function searchHelpDocs(
  query: string,
  topK = 5,
  embedder: Pick<EmbedderService, 'embed'> = getSharedEmbedder(),
): Promise<HelpSearchResult> {
  const corpus = getHelpDocsCorpus();
  if (corpus.length === 0) return { hits: [], weakMatch: true };

  const [queryVector] = await embedder.embed([query]);
  if (!queryVector) return { hits: [], weakMatch: true };

  const hits: HelpHit[] = corpus
    .map((c) => ({
      id: c.id,
      sourcePage: c.sourcePage,
      pageTitle: c.pageTitle,
      heading: c.heading,
      text: c.text,
      score: cosineSimilarity(queryVector, c.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const weakMatch = hits.length === 0 || hits[0]!.score < WEAK_MATCH_THRESHOLD;
  return { hits, weakMatch };
}
