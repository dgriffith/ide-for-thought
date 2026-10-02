/**
 * Answer an export's request to render live blocks (#2510). The export
 * pipeline (main) asks the window that started it; this renders each block
 * with the preview's own components and replies, one block at a time (an
 * export can hold many views; rendering them serially keeps one mounted at
 * a time). A block that fails becomes that block's error — the export shows
 * a one-line note in its place — and never stops the others.
 */
import { api } from '../ipc/client';
import type { LiveBlockRequest, LiveBlockResult } from '../../../shared/live-blocks';
import { renderObjectViewForExport } from '../export/render-object-view';
import { renderQueryBlockForExport } from '../export/render-query-block';
import { renderMermaidForExport } from '../export/render-mermaid';
import { renderArgumentMapForExport } from '../export/render-argument-map';
import { renderOutputForExport } from '../export/render-output';

export async function renderLiveBlock(block: LiveBlockRequest): Promise<LiveBlockResult> {
  try {
    switch (block.kind) {
      case 'object-view':
        return { id: block.id, ok: true, html: await renderObjectViewForExport(block.source) };
      case 'mermaid':
        return { id: block.id, ok: true, html: await renderMermaidForExport(block.source) };
      case 'argument':
        return { id: block.id, ok: true, html: await renderArgumentMapForExport(block.source) };
      case 'output':
        return { id: block.id, ok: true, html: renderOutputForExport(block.source) };
      case 'query':
        return { id: block.id, ok: true, html: await renderQueryBlockForExport(block.source, block.notePath) };
    }
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
