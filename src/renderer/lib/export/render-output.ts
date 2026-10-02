/**
 * Render a ```output block (a saved compute-cell result) for an export
 * (#2515, epic #2508) with the preview's own `renderComputeOutput`: text,
 * tables (with the truncation footer), JSON, images and sanitized HTML, as
 * the preview shows them. Passing no source cell leaves out the preview's
 * "⋯" save-as-note menu — nothing to drive it on a static page.
 */
import { renderComputeOutput } from '../preview/compute-output-render';
import { snapshotLiveBlock } from './live-block-snapshot';
import { EXPORT_BLOCK_WIDTH_PX } from './render-object-view';

export function renderOutputForExport(source: string): string {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_BLOCK_WIDTH_PX}px;pointer-events:none;`;
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.innerHTML = renderComputeOutput(source, null);
  themed.appendChild(preview);
  host.appendChild(themed);
  document.body.appendChild(host);
  try {
    return snapshotLiveBlock(themed);
  } finally {
    host.remove();
  }
}
