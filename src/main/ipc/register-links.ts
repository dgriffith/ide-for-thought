import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import * as vectors from '../embeddings/vector-store';
import { topRelatedNotes } from '../embeddings/related';
import { projectContext } from '../project-context-types';
import { rootPathFromEvent } from './helpers';
import type { RelatedNotesResult } from '../../shared/types';

export function registerLinks(): void {
  // Semantically-related notes for the Related sidebar panel (#838). Uses the
  // active note's stored chunk vectors (no embedding at query time), de-duped to
  // the single best section per note and enriched with display titles.
  ipcMain.handle(Channels.EMBEDDINGS_RELATED, async (e, relativePath: string, limit?: number): Promise<RelatedNotesResult> => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { enabled: false, notes: [] };
    const ctx = projectContext(rootPath);
    if (!vectors.isEnabled(ctx)) return { enabled: false, notes: [] };
    const n = Math.min(Math.max(Math.floor(limit ?? 8), 1), 25);
    // Over-fetch chunk hits so best-per-note still yields ~n notes.
    const hits = await vectors.relatedToNote(ctx, relativePath, { limit: n * 5 });
    const notes = topRelatedNotes(hits, { limit: n, titleOf: (p) => graph.noteTitle(ctx, p) });
    return { enabled: true, notes };
  });
  // Links
  ipcMain.handle(Channels.LINKS_OUTGOING, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.outgoingLinks(projectContext(rootPath), relativePath);
  });

  ipcMain.handle(Channels.LINKS_BACKLINKS, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.backlinks(projectContext(rootPath), relativePath);
  });

  // Coalesced bundle for the right-sidebar link panels (#351). Replaces
  // the parallel LINKS_OUTGOING + LINKS_BACKLINKS round-trips on every
  // tab switch — one IPC, one graph-state pass, both directions together.
  ipcMain.handle(Channels.LINKS_BUNDLE, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { outgoing: [], backlinks: [] };
    const ctx = projectContext(rootPath);
    return {
      outgoing: graph.outgoingLinks(ctx, relativePath),
      backlinks: graph.backlinks(ctx, relativePath),
    };
  });

  ipcMain.handle(
    Channels.LINKS_CITATIONS_FOR_NOTE,
    async (e, relativePath: string, content?: string) => {
      const rootPath = rootPathFromEvent(e);
      if (!rootPath) return [];
      // Renderer can pass live content (current editor buffer) so the
      // count reflects what the user is typing right now. Falling back
      // to disk preserves correctness when the panel refreshes from a
      // graph event without an open editor buffer.
      const text = content ?? await notebaseFs.readFile(rootPath, relativePath).catch(() => '');
      return graph.citationsForNote(projectContext(rootPath), relativePath, text);
    },
  );

  ipcMain.handle(Channels.LINKS_EXTERNAL_INBOUND, (e, paths: string[]) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return graph.findExternalInboundLinks(projectContext(rootPath), paths);
  });

  // Depth-N link neighborhood for the graph view (#846).
  ipcMain.handle(Channels.LINKS_NEIGHBORHOOD, (e, relativePath: string, opts?: graph.NeighborhoodOptions) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { nodes: [], edges: [], truncated: false };
    return graph.neighborhood(projectContext(rootPath), relativePath, opts ?? {});
  });

  // Single hop out of a node — expand-on-demand (#846).
  ipcMain.handle(Channels.LINKS_EXPAND_NODE, (e, relativePath: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { nodes: [], edges: [], expandTo: [] };
    return graph.expandNode(projectContext(rootPath), relativePath);
  });
}
