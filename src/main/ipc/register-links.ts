import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import * as vectors from '../embeddings/vector-store';
import type { RefKind } from '../embeddings/vector-store';
import { topRelatedNotes, markAlreadyLinked } from '../embeddings/related';
import { projectContext } from '../project-context-types';
import { withRootPathOr } from './helpers';
import type { RelatedNotesResult, CitationGroup } from '../../shared/types';

export function registerLinks(): void {
  // Semantically-related notes for the Related sidebar panel (#838). Uses the
  // active note's stored chunk vectors (no embedding at query time), de-duped to
  // the single best section per note and enriched with display titles.
  handle(Channels.EMBEDDINGS_RELATED, withRootPathOr<[string, number?], RelatedNotesResult | Promise<RelatedNotesResult>>({ enabled: false, notes: [] }, async (rootPath, relativePath: string, limit?: number): Promise<RelatedNotesResult> => {
    const ctx = projectContext(rootPath);
    if (!vectors.isEnabled(ctx)) return { enabled: false, notes: [] };
    const n = Math.min(Math.max(Math.floor(limit ?? 8), 1), 25);
    // Over-fetch chunk hits so best-per-ref de-dup still yields ~n results.
    // Span all kinds — notes, source bodies, and excerpts (#839).
    const hits = await vectors.relatedToNote(ctx, relativePath, { limit: n * 5 });
    const ranked = topRelatedNotes(hits, {
      limit: n,
      titleOf: (h) => {
        if (h.kind === 'source') return graph.sourceTitle(ctx, h.ref);
        if (h.kind === 'excerpt') return 'Excerpt';
        return graph.noteTitle(ctx, h.ref);
      },
    });
    // Flag note hits already wiki-linked to the active note (either direction),
    // so the panel offers "suggest link" only on unlinked-but-related ones (#840).
    const linked = new Set<string>([
      ...graph.outgoingLinks(ctx, relativePath).map((l) => l.target),
      ...graph.backlinks(ctx, relativePath).map((l) => l.source),
    ]);
    return { enabled: true, notes: markAlreadyLinked(ranked, linked) };
  }));

  // Unlinked mentions of a typed object (#1074): notes that semantically mention
  // this object — pointed at its TITLE + ALIASES (not its whole content, unlike
  // EMBEDDINGS_RELATED) — but don't yet wiki-link it. Reuses the embed-at-query
  // machinery (searchRelated embeds the title string) + the already-linked flag,
  // so the surface can suggest "link it" only on genuinely unlinked notes.
  handle(Channels.EMBEDDINGS_UNLINKED_MENTIONS, withRootPathOr<[string, number?], RelatedNotesResult | Promise<RelatedNotesResult>>({ enabled: false, notes: [] }, async (rootPath, relativePath: string, limit?: number): Promise<RelatedNotesResult> => {
    const ctx = projectContext(rootPath);
    if (!vectors.isEnabled(ctx)) return { enabled: false, notes: [] };
    const query = [graph.noteTitle(ctx, relativePath), ...graph.aliasesForNote(ctx, relativePath)]
      .filter((s) => s.trim()).join('\n');
    if (!query.trim()) return { enabled: true, notes: [] };
    const n = Math.min(Math.max(Math.floor(limit ?? 8), 1), 25);
    const hits = await vectors.searchRelated(ctx, query, { limit: n * 5, kinds: ['note'], exclude: { kind: 'note', ref: relativePath } });
    const ranked = topRelatedNotes(hits, { limit: n, titleOf: (h) => graph.noteTitle(ctx, h.ref) });
    // Already-linked = a note that links this object in either direction; the
    // surface shows only the unlinked ones.
    const linked = new Set<string>([
      ...graph.outgoingLinks(ctx, relativePath).map((l) => l.target),
      ...graph.backlinks(ctx, relativePath).map((l) => l.source),
    ]);
    return { enabled: true, notes: markAlreadyLinked(ranked, linked) };
  }));

  // Free-text semantic search for the live `:::query-semantic` block (#1128).
  // Embeds the block's query text at request time (searchRelated does the
  // embed) and ranks the corpus — read-only, nothing is written. `excludePath`
  // drops the host note from its own results; `kinds` restricts the corpus.
  handle(
    Channels.EMBEDDINGS_SEARCH_TEXT,
    withRootPathOr<[string, { limit?: number; kinds?: readonly RefKind[]; excludePath?: string }?], RelatedNotesResult | Promise<RelatedNotesResult>>(
      { enabled: false, notes: [] },
      async (rootPath, query: string, opts): Promise<RelatedNotesResult> => {
        const ctx = projectContext(rootPath);
        if (!vectors.isEnabled(ctx) || !query.trim()) return { enabled: false, notes: [] };
        const n = Math.min(Math.max(Math.floor(opts?.limit ?? 8), 1), 25);
        const hits = await vectors.searchRelated(ctx, query, {
          limit: n * 5,
          ...(opts?.kinds && opts.kinds.length > 0 ? { kinds: opts.kinds } : {}),
          ...(opts?.excludePath ? { exclude: { kind: 'note' as const, ref: opts.excludePath } } : {}),
        });
        const ranked = topRelatedNotes(hits, {
          limit: n,
          titleOf: (h) => {
            if (h.kind === 'source') return graph.sourceTitle(ctx, h.ref);
            if (h.kind === 'excerpt') return 'Excerpt';
            return graph.noteTitle(ctx, h.ref);
          },
        });
        return { enabled: true, notes: ranked };
      },
    ),
  );
  // Links
  handle(Channels.LINKS_OUTGOING, withRootPathOr([], (rootPath, relativePath: string) =>
    graph.outgoingLinks(projectContext(rootPath), relativePath)));

  handle(Channels.LINKS_BACKLINKS, withRootPathOr([], (rootPath, relativePath: string) =>
    graph.backlinks(projectContext(rootPath), relativePath)));

  // Coalesced bundle for the right-sidebar link panels (#351). Replaces
  // the parallel LINKS_OUTGOING + LINKS_BACKLINKS round-trips on every
  // tab switch — one IPC, one graph-state pass, both directions together.
  handle(Channels.LINKS_BUNDLE, withRootPathOr({ outgoing: [], backlinks: [] }, (rootPath, relativePath: string) => {
    const ctx = projectContext(rootPath);
    return {
      outgoing: graph.outgoingLinks(ctx, relativePath),
      backlinks: graph.backlinks(ctx, relativePath),
    };
  }));

  handle(
    Channels.LINKS_CITATIONS_FOR_NOTE,
    withRootPathOr<[string, string?], CitationGroup[] | Promise<CitationGroup[]>>([], async (rootPath, relativePath: string, content?: string) => {
      // Renderer can pass live content (current editor buffer) so the
      // count reflects what the user is typing right now. Falling back
      // to disk preserves correctness when the panel refreshes from a
      // graph event without an open editor buffer.
      const text = content ?? await notebaseFs.readFile(rootPath, relativePath).catch(() => '');
      return graph.citationsForNote(projectContext(rootPath), relativePath, text);
    }),
  );

  handle(Channels.LINKS_EXTERNAL_INBOUND, withRootPathOr([], (rootPath, paths: string[]) =>
    graph.findExternalInboundLinks(projectContext(rootPath), paths)));

  // Depth-N link neighborhood for the graph view (#846).
  handle(Channels.LINKS_NEIGHBORHOOD, withRootPathOr({ nodes: [], edges: [], truncated: false }, (rootPath, relativePath: string, opts?: graph.NeighborhoodOptions) =>
    graph.neighborhood(projectContext(rootPath), relativePath, opts ?? {})));

  // Single hop out of a node — expand-on-demand (#846).
  handle(Channels.LINKS_EXPAND_NODE, withRootPathOr({ nodes: [], edges: [], expandTo: [] }, (rootPath, relativePath: string) =>
    graph.expandNode(projectContext(rootPath), relativePath)));
}
