/**
 * Render a ```mermaid block for an export (#2513, epic #2508) with the
 * preview's own mermaid setup, inside the preview's `.mermaid-block`
 * container, light-themed — kept as inline SVG (crisp at any zoom and in PDF,
 * text selectable). A diagram that doesn't parse shows the preview's own
 * "Mermaid error" box, as the preview does.
 */
import { mermaidErrorHtml, renderMermaidSvgForExport } from '../markdown/mermaid-renderer';
import { snapshotLiveBlock } from './live-block-snapshot';
import { EXPORT_BLOCK_WIDTH_PX } from './render-object-view';

/** The export page's sans stack (note-html's heading font): fonts a reader has,
 *  so the labels are measured in what they'll be drawn in. */
export const EXPORT_DIAGRAM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

export async function renderMermaidForExport(source: string): Promise<string> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_BLOCK_WIDTH_PX}px;pointer-events:none;font-family:${EXPORT_DIAGRAM_FONT};`;
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  const preview = document.createElement('div');
  preview.className = 'preview';
  const block = document.createElement('div');
  block.className = 'mermaid-block';
  preview.appendChild(block);
  themed.appendChild(preview);
  host.appendChild(themed);
  document.body.appendChild(host);
  try {
    try {
      // Trimmed as the preview trims it (`hydrateMermaidBlocks`), so even an
      // error names the same line.
      block.innerHTML = await renderMermaidSvgForExport(source.trim(), themed, EXPORT_DIAGRAM_FONT);
      block.setAttribute('data-mermaid-rendered', 'ok');
    } catch (err) {
      block.innerHTML = mermaidErrorHtml(err instanceof Error ? err.message : String(err));
      block.setAttribute('data-mermaid-rendered', 'error');
    }
    return snapshotLiveBlock(themed);
  } finally {
    host.remove();
  }
}
