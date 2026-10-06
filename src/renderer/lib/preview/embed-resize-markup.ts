/**
 * The preview markup for a resizable image or object-view embed (#2666): a
 * frame carrying what the resize controller (`embed-resize.ts`) needs to find
 * the thing in the note's source again, and a handle to drag.
 *
 * Emitted by the markdown rules themselves rather than added to the DOM after
 * render, so it's part of `{@html rendered}` like every other placeholder and
 * passes through `sanitizeNoteHtml` (which keeps `data-*`, `role`, `tabindex`
 * and `aria-*`). The handle is a focusable `role="slider"`: it is the thing
 * Alt+arrows step and a screen reader reports the size of.
 */
import { escapeAttr } from './text';
import { IMAGE_MAX_PX, IMAGE_MIN_PX, type ImageSourceRef } from '../../../shared/markdown/image-size';
import { OBJECT_VIEW_MAX_HEIGHT, OBJECT_VIEW_MIN_HEIGHT } from '../../../shared/objects/view-height';

export const RESIZE_KIND_ATTR = 'data-resize-kind';
export const RESIZE_KEY_ATTR = 'data-resize-key';
export const RESIZE_HANDLE_ATTR = 'data-resize-handle';
export const IMAGE_REF_ATTR = 'data-image-ref';

function handle(label: string, orientation: 'horizontal' | 'vertical', min: number, max: number, now: number | null): string {
  const value = now !== null ? ` aria-valuenow="${now}" aria-valuetext="${now} pixels"` : ' aria-valuetext="natural size"';
  return `<span class="resize-handle resize-handle-${orientation === 'horizontal' ? 'corner' : 'bottom'}" ${RESIZE_HANDLE_ATTR}="1"`
    + ` role="slider" tabindex="0" aria-label="${label}" aria-orientation="${orientation}"`
    + ` aria-valuemin="${min}" aria-valuemax="${max}"${value}`
    + ` title="Drag to resize · Alt+arrows · double-click to reset"></span>`;
}

/** An image in its frame, with a bottom-right handle that sets the width. */
export function imageResizeFrame(img: string, ref: ImageSourceRef, width: number | null): string {
  return `<span class="resizable-image" ${RESIZE_KIND_ATTR}="image" ${RESIZE_KEY_ATTR}="image:${ref.line}:${ref.index}"`
    + ` ${IMAGE_REF_ATTR}="${escapeAttr(JSON.stringify(ref))}">`
    + img
    + handle('Image width', 'horizontal', IMAGE_MIN_PX, IMAGE_MAX_PX, width)
    + `</span>`;
}

/** The bottom-edge handle under an object-view embed; sets its height. */
export function objectViewResizeHandle(height: number): string {
  return handle('View height', 'vertical', OBJECT_VIEW_MIN_HEIGHT, OBJECT_VIEW_MAX_HEIGHT, height);
}
