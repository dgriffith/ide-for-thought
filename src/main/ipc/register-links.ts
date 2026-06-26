import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import * as notebaseFs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { rootPathFromEvent } from './helpers';

export function registerLinks(): void {
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
