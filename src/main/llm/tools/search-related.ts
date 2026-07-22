import { projectContext } from '../../project-context-types';
import * as vectors from '../../embeddings/vector-store';
import type { RelatedHit, RefKind } from '../../embeddings/vector-store';
import type { NotebaseTool, ToolContext } from './types';

async function runSearchRelated(
  ctx: ToolContext,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  const { query, relative_path, limit, kinds } = input as {
    query?: string; relative_path?: string; limit?: number; kinds?: RefKind[];
  };
  const pctx = projectContext(ctx.rootPath);

  if (!vectors.isEnabled(pctx)) {
    return {
      content: 'Semantic search is not available for this thoughtbase (embeddings are not initialized).',
      isError: false,
    };
  }

  const n = Math.min(Math.max(Math.floor(limit ?? 10), 1), 50);
  const kindFilter = Array.isArray(kinds) && kinds.length > 0 ? kinds : undefined;
  let hits: RelatedHit[];
  let descriptor: string;

  if (typeof relative_path === 'string' && relative_path.trim()) {
    // Over-fetch chunk-level hits so best-per-ref de-dup still yields ~n results.
    hits = await vectors.relatedToNote(pctx, relative_path.trim(), { limit: n * 5, ...(kindFilter ? { kinds: kindFilter } : {}) });
    descriptor = `related to ${relative_path.trim()}`;
    if (hits.length === 0) {
      return {
        content:
          `No related items found for "${relative_path.trim()}". The note may not be ` +
          `indexed yet — semantic indexing runs in the background, so results can be ` +
          `incomplete shortly after a note is created or the model changes.`,
        isError: false,
      };
    }
  } else if (typeof query === 'string' && query.trim()) {
    hits = await vectors.searchRelated(pctx, query.trim(), { limit: n * 5, ...(kindFilter ? { kinds: kindFilter } : {}) });
    descriptor = `for "${query.trim()}"`;
  } else {
    throw new Error('Provide either `query` (free text) or `relative_path` (a note to find relatives of).');
  }

  const best = bestPerRef(hits).slice(0, n);
  if (best.length === 0) {
    return { content: `No semantically related items found ${descriptor}.`, isError: false };
  }
  const body = best
    .map((h, i) => {
      const heading = h.sectionHeading || '(intro)';
      const snippet = h.chunkText.replace(/\s+/g, ' ').trim().slice(0, 240);
      // Label the corpus so the model can route (read_note vs. a source/excerpt).
      const tag = h.kind === 'note' ? '' : `[${h.kind}] `;
      return `${i + 1}. ${tag}${h.ref} — ${heading} (similarity ${h.score.toFixed(2)})\n   ${snippet}`;
    })
    .join('\n');
  return { content: body, isError: false };
}

/** Collapse chunk-level hits to one row per (kind, ref), keeping each ref's best
 *  (highest-scoring) chunk, ordered by score descending. */
function bestPerRef(hits: RelatedHit[]): RelatedHit[] {
  const best = new Map<string, RelatedHit>();
  for (const h of hits) {
    const key = `${h.kind}:${h.ref}`;
    const prev = best.get(key);
    if (!prev || h.score > prev.score) best.set(key, h);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export const searchRelated: NotebaseTool = {
  definition: {
    name: 'search_related',
    description:
      'Semantic (meaning-based) search across the thoughtbase — notes, source ' +
      'bodies, and excerpts. Returns items whose content is conceptually similar ' +
      'to a query, even when they share no keywords — embeddings, not text ' +
      'matching. Two modes: pass `query` for free-text ("how trust is ' +
      'established"), or `relative_path` to find items related to an existing ' +
      'note ("what else is like this one"). Optionally restrict with `kinds` ' +
      '(e.g. ["excerpt"] to mine the research library). Each result names its ' +
      'kind, the matched section, and a similarity score (0–1); a `[source]` / ' +
      '`[excerpt]` tag marks library hits. Read a full hit by kind: `read_source` ' +
      'for a `[source]`, `read_note` for a plain note (untagged); an `[excerpt]` ' +
      'is anchored to a source, so read its `[source]` for the surrounding text.\n' +
      'Choosing among the search tools: use search_related for "find things ' +
      'like / about this" by meaning; use search_notes for exact keywords or ' +
      'phrases; use query_graph for structural questions (links, tags, types, ' +
      'claims); use search_help for questions about Minerva itself rather than ' +
      'the user\'s own thoughtbase. They complement each other — combine when unsure.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text description of what to find, matched by meaning.',
        },
        relative_path: {
          type: 'string',
          description:
            'Instead of `query`, find notes related to this note (uses the ' +
            'note\'s own content as the query). The note itself is excluded.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of items to return. Defaults to 10.',
          minimum: 1,
          maximum: 50,
        },
        kinds: {
          type: 'array',
          description: 'Restrict to these corpora. Omit for all.',
          items: { type: 'string', enum: ['note', 'source', 'excerpt'] },
        },
      },
    },
  },
  run: (ctx, input) => runSearchRelated(ctx, input),
};
