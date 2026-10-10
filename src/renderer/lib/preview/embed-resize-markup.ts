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
import { OBJECT_VIEW_MAX_WIDTH, OBJECT_VIEW_MIN_WIDTH } from '../../../shared/objects/view-width';

export const RESIZE_KIND_ATTR = 'data-resize-kind';
export const RESIZE_KEY_ATTR = 'data-resize-key';
export const RESIZE_HANDLE_ATTR = 'data-resize-handle';
export const IMAGE_REF_ATTR = 'data-image-ref';
/** Which dimension a handle sets: `width` or `height`. */
export const RESIZE_AXIS_ATTR = 'data-resize-axis';

type Placement = 'corner' | 'bottom' | 'right';

function handle(label: string, placement: Placement, min: number, max: number, now: number | null, unset = 'natural size'): string {
  const axis = placement === 'bottom' ? 'height' : 'width';
  const orientation = axis === 'width' ? 'horizontal' : 'vertical';
  const value = now !== null ? ` aria-valuenow="${now}" aria-valuetext="${now} pixels"` : ` aria-valuetext="${unset}"`;
  return `<span class="resize-handle resize-handle-${placement}" ${RESIZE_HANDLE_ATTR}="1" ${RESIZE_AXIS_ATTR}="${axis}"`
    + ` role="slider" tabindex="0" aria-label="${label}" aria-orientation="${orientation}"`
    + ` aria-valuemin="${min}" aria-valuemax="${max}"${value}`
    + ` title="Drag to resize · Alt+arrows · double-click to reset"></span>`;
}

/** An image in its frame, with a bottom-right handle that sets the width. */
export function imageResizeFrame(img: string, ref: ImageSourceRef, width: number | null): string {
  return `<span class="resizable-image" ${RESIZE_KIND_ATTR}="image" ${RESIZE_KEY_ATTR}="image:${ref.line}:${ref.index}"`
    + ` ${IMAGE_REF_ATTR}="${escapeAttr(JSON.stringify(ref))}">`
    + img
    + handle('Image width', 'corner', IMAGE_MIN_PX, IMAGE_MAX_PX, width)
    + `</span>`;
}

/** The bottom-edge handle under an object-view embed; sets its height. */
export function objectViewResizeHandle(height: number): string {
  return handle('View height', 'bottom', OBJECT_VIEW_MIN_HEIGHT, OBJECT_VIEW_MAX_HEIGHT, height);
}

/** The right-edge handle beside an object-view embed; sets its width (#2709),
 *  which may take it past the reading column. Null = fills the column. */
export function objectViewWidthHandle(width: number | null): string {
  return handle('View width', 'right', OBJECT_VIEW_MIN_WIDTH, OBJECT_VIEW_MAX_WIDTH, width, 'column width');
}
