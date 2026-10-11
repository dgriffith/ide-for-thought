/**
 * Answer an export's request to render live blocks (#2510). The export
 * pipeline (main) asks the window that started it; this renders each block
 * with the preview's own components and replies, one block at a time (an
 * export can hold many views; rendering them serially keeps one mounted at
 * a time). A block that fails becomes that block's error — the export shows
 * a one-line note in its place — and never stops the others.
 */
import { api } from '../ipc/client';
import type { LiveBlockRequest, LiveBlockResult, WindowBlockKind } from '../../../shared/live-blocks';
import { renderObjectViewForExport } from '../export/render-object-view';
import { renderQueryBlockForExport } from '../export/render-query-block';
import { renderMermaidForExport } from '../export/render-mermaid';
import { renderArgumentMapForExport } from '../export/render-argument-map';
import { renderOutputForExport } from '../export/render-output';
import { renderCardForExport } from '../export/render-card';

/**
 * The export half of each `window` live-block kind (#2624): its HTML, drawn
 * with the preview's own components. Keyed by kind, so a `window` kind
 * registered in `shared/live-blocks.ts` without a renderer here doesn't
 * compile.
 */
export const WINDOW_RENDERERS: Record<WindowBlockKind, (block: LiveBlockRequest) => string | Promise<string>> = {
  'object-view': (b) => renderObjectViewForExport(b.source, { paged: b.paged === true }),
  mermaid: (b) => renderMermaidForExport(b.source),
  argument: (b) => renderArgumentMapForExport(b.source),
  output: (b) => renderOutputForExport(b.source),
  card: (b) => renderCardForExport(b.source),
  query: (b) => renderQueryBlockForExport(b.source, b.notePath),
};

export async function renderLiveBlock(block: LiveBlockRequest): Promise<LiveBlockResult> {
  try {
    return { id: block.id, ok: true, html: await WINDOW_RENDERERS[block.kind](block) };
  } catch (err) {
    return { id: block.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Subscribe once, from the App's IPC wiring. */
export function installExportLiveBlockRenderer(): () => void {
  return api.publish.onRenderLiveBlocks(({ requestId, blocks }) => {
    void (async () => {
      const results: LiveBlockResult[] = [];
      for (const block of blocks) results.push(await renderLiveBlock(block));
      await api.publish.liveBlocksRendered(requestId, results);
    })();
  });
}
