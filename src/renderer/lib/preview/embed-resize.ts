/**
 * Resizing images and object-view embeds in the preview (#2666; an embed's
 * width, #2709).
 *
 * One delegated controller per preview element, driving the handles that
 * `embed-resize-markup.ts` emits:
 *
 * - **Drag** — pointer events with pointer capture, never HTML5 drag-and-drop
 *   (which suspends the renderer's reactivity on macOS Electron). The frame
 *   resizes live while dragging; releasing writes the size into the note.
 * - **Keyboard** — with focus on the handle (or anywhere inside the embed),
 *   Alt+arrows step the size and Alt+0 resets it. An object view has two
 *   handles: Alt+←/→ step its width and Alt+↑/↓ its height; Alt+0 resets the
 *   focused handle's dimension, or both away from a handle. On a handle the
 *   plain arrows step its own dimension, as a slider's should. Each step is announced
 *   through the app's live region; the write waits for a short pause so a
 *   run of steps is one edit rather than one per key.
 * - **Double-click** on the handle resets to the default.
 *
 * A write is a plain text edit of the note — `applyImageSize` /
 * `applyObjectViewHeight` / `applyObjectViewWidth` against the current
 * content — handed to the host's
 * `applyEdit`, which puts it in the open editor's document like any user edit
 * (undoable, marks the tab dirty, autosaves). It is never an LLM write. If the
 * image or fence is no longer where the rendered DOM says (the note changed
 * under the gesture), nothing is written.
 *
 * The write re-renders the preview, which replaces the focused handle; the
 * controller remembers which one had focus and `restoreResizeFocus` puts it
 * back after the next render.
 */
import { announce } from '../stores/announcer.svelte';
import {
  IMAGE_MIN_PX, applyImageSize, clampImageDimension, parseImageSizeSuffix,
  type ImageSize, type ImageSourceRef,
} from '../../../shared/markdown/image-size';
import {
  OBJECT_VIEW_DEFAULT_HEIGHT, applyObjectViewHeight, clampViewHeight,
} from '../../../shared/objects/view-height';
import { OBJECT_VIEW_MIN_WIDTH, applyObjectViewWidth, clampViewWidth } from '../../../shared/objects/view-width';
import { IMAGE_REF_ATTR, RESIZE_AXIS_ATTR, RESIZE_HANDLE_ATTR, RESIZE_KEY_ATTR, RESIZE_KIND_ATTR } from './embed-resize-markup';

export interface EmbedResizeOps {
  /** The note's current source. */
  getContent: () => string;
  /** Write the edited source back (the open editor's document). */
  applyEdit: (next: string) => void;
}

/** px per Alt+arrow step. */
export const IMAGE_STEP_PX = 20;
export const VIEW_STEP_PX = 40;
/** How long a run of keyboard steps waits before it's written. */
export const KEYBOARD_COMMIT_DELAY_MS = 400;

type Kind = 'image' | 'object-view';
type Axis = 'width' | 'height';

/** The space kept between a wide embed and the pane's right edge — the same
 *  as the column's left padding. */
export const PREVIEW_GUTTER_PX = 48;
/** The reading column's text width, for when it can't be measured. */
const READING_COLUMN_PX = 704;

/** How long after a write a re-render may still hand focus back. A write can
 *  cause more than one re-render (the edit itself, then the save's), and each
 *  replaces the focused handle. */
export const FOCUS_RESTORE_WINDOW_MS = 3000;

const pendingFocus = new WeakMap<HTMLElement, { key: string; until: number; axis: Axis | null }>();

interface Target {
  frame: HTMLElement;
  kind: Kind;
  axis: Axis;
}

/** The embed `el` is in, sized along the axis of the handle `el` is on — or,
 *  away from a handle, `axis` (an image only has a width). */
function targetOf(el: Element | null, axis: Axis = 'height'): Target | null {
  const frame = el?.closest<HTMLElement>(`[${RESIZE_KIND_ATTR}]`) ?? null;
  if (!frame) return null;
  const kind = frame.getAttribute(RESIZE_KIND_ATTR);
  if (kind !== 'image' && kind !== 'object-view') return null;
  if (kind === 'image') return { frame, kind, axis: 'width' };
  const onHandle = el?.closest(`[${RESIZE_HANDLE_ATTR}]`)?.getAttribute(RESIZE_AXIS_ATTR);
  return { frame, kind, axis: onHandle === 'width' || onHandle === 'height' ? onHandle : axis };
}

/** The frame's source position — markup the image rule wrote, so it parses. */
function imageRef(frame: HTMLElement): ImageSourceRef | null {
  const raw = frame.getAttribute(IMAGE_REF_ATTR);
  return raw ? JSON.parse(raw) as ImageSourceRef : null;
}

const imgOf = (frame: HTMLElement) => frame.querySelector<HTMLImageElement>('img');
const blockOf = (frame: HTMLElement) => frame.querySelector<HTMLElement>('.object-view-block');
const handleOf = (frame: HTMLElement, axis?: Axis) => frame.querySelector<HTMLElement>(
  axis ? `[${RESIZE_HANDLE_ATTR}][${RESIZE_AXIS_ATTR}="${axis}"]` : `[${RESIZE_HANDLE_ATTR}]`,
);

/**
 * How wide a top-level embed may be drawn in this preview (#2709): from the
 * reading column's left edge to the pane's right edge, less a gutter. Zero
 * when it can't be measured. `observePreviewRoom` publishes it as `--preview-room`
 * for the CSS, and the drag clamps to it, so the two agree.
 */
export function previewRoom(root: HTMLElement): number {
  const padLeft = parseFloat(getComputedStyle(root).paddingLeft) || 0;
  return Math.max(0, Math.floor(root.clientWidth - padLeft - PREVIEW_GUTTER_PX));
}

/**
 * Keep `--preview-room` on the preview current as the pane resizes. The
 * column is held by padding, so CSS alone can't see how far past it an embed
 * may reach. Returns the teardown.
 */
export function observePreviewRoom(root: HTMLElement): () => void {
  const measure = () => root.style.setProperty('--preview-room', `${previewRoom(root)}px`);
  measure();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const ro = new ResizeObserver(measure);
  ro.observe(root);
  return () => ro.disconnect();
}

/** The room an embed has: the pane's, at the top level; inside a list or a
 *  quote, its container's (the CSS caps it there too). */
function viewRoom(root: HTMLElement, frame: HTMLElement): number {
  return frame.parentElement === root ? previewRoom(root) : Math.floor(columnWidth(frame));
}

function clampViewWidthIn(root: HTMLElement, frame: HTMLElement, w: number): number {
  const clamped = clampViewWidth(w);
  const room = viewRoom(root, frame);
  return room > 0 ? Math.max(OBJECT_VIEW_MIN_WIDTH, Math.min(clamped, room)) : clamped;
}

/** The embed's width as drawn now — a live drag/step width included. */
function currentViewWidth(frame: HTMLElement): number {
  const rendered = frame.getBoundingClientRect().width;
  if (rendered > 0) return rendered;
  const set = parseFloat(frame.style.getPropertyValue('--view-width')) || Number(frame.dataset.viewWidth);
  return set > 0 ? set : READING_COLUMN_PX;
}

/** The width the image's column offers; 0 when it can't be measured. */
function columnWidth(frame: HTMLElement): number {
  const col = frame.parentElement;
  if (!col) return 0;
  const cs = getComputedStyle(col);
  return col.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
}

function clampImageWidth(frame: HTMLElement, w: number): number {
  const col = columnWidth(frame);
  const clamped = clampImageDimension(w);
  return col > 0 ? Math.max(IMAGE_MIN_PX, Math.min(clamped, Math.floor(col))) : clamped;
}

/** The image's width as drawn now: a live drag/step size, else its stored or rendered one. */
function currentImageWidth(frame: HTMLElement): number {
  const img = imgOf(frame);
  const live = parseFloat(img?.style.width ?? '');
  if (live > 0) return live;
  // As drawn — but only once it has loaded: a placeholder still waiting for
  // its data URL is drawn at its alt text's width, not the image's.
  const loaded = !!img && img.complete && img.naturalWidth > 0;
  const rendered = loaded ? img.getBoundingClientRect().width : 0;
  if (rendered > 0) return rendered;
  const stored = parseImageSizeSuffix(imageRef(frame)?.label ?? '').size?.width;
  return stored ?? (img && img.naturalWidth > 0 ? img.naturalWidth : IMAGE_MIN_PX);
}

function currentViewHeight(frame: HTMLElement): number {
  const block = blockOf(frame);
  const live = parseFloat(block?.style.height ?? '');
  if (live > 0) return live;
  const stored = Number(block?.dataset.viewHeight);
  return stored > 0 ? stored : OBJECT_VIEW_DEFAULT_HEIGHT;
}

/** The stored size scaled to a new width, keeping a given height in proportion. */
function imageSizeForWidth(frame: HTMLElement, width: number): ImageSize {
  const stored = parseImageSizeSuffix(imageRef(frame)?.label ?? '').size;
  const height = stored?.height != null && stored.width > 0
    ? clampImageDimension(stored.height * width / stored.width)
    : null;
  return { width, height };
}

function showImageSize(frame: HTMLElement, width: number): void {
  const img = imgOf(frame);
  if (!img) return;
  const size = imageSizeForWidth(frame, width);
  img.style.width = `${width}px`;
  img.style.height = size.height !== null ? `${size.height}px` : 'auto';
  setHandleValue(frame, width);
}

function showViewHeight(frame: HTMLElement, height: number): void {
  const block = blockOf(frame);
  if (block) block.style.height = `${height}px`;
  setHandleValue(frame, height, 'height');
}

function showViewWidth(frame: HTMLElement, width: number): void {
  frame.dataset.viewWidth = String(width);
  frame.style.setProperty('--view-width', `${width}px`);
  setHandleValue(frame, width, 'width');
}

function setHandleValue(frame: HTMLElement, px: number, axis?: Axis): void {
  const h = handleOf(frame, axis);
  if (!h) return;
  h.setAttribute('aria-valuenow', String(Math.round(px)));
  h.setAttribute('aria-valuetext', `${Math.round(px)} pixels`);
}

function describe(t: Pick<Target, 'kind' | 'axis'>, px: number | null): string {
  if (t.kind === 'image') return px === null ? 'Image reset to its natural size' : `Image width ${Math.round(px)} pixels`;
  if (t.axis === 'width') return px === null ? 'View width reset to the column' : `View width ${Math.round(px)} pixels`;
  return px === null
    ? `View height reset to ${OBJECT_VIEW_DEFAULT_HEIGHT} pixels`
    : `View height ${Math.round(px)} pixels`;
}

/**
 * Write a size (null = reset) for the frame's image / embed into the note.
 * Returns whether anything was written.
 */
/** The element carrying `frame`'s key in the preview now — `frame` itself
 *  unless a re-render has replaced it. */
function liveFrame(root: HTMLElement, frame: HTMLElement): HTMLElement {
  const key = frame.getAttribute(RESIZE_KEY_ATTR);
  return (key && root.querySelector<HTMLElement>(`[${RESIZE_KEY_ATTR}="${CSS.escape(key)}"]`)) || frame;
}

/** Hand focus back to this frame's handle after the re-renders a write causes. */
function rememberFocus(root: HTMLElement, frame: HTMLElement, stepped?: Axis): void {
  const key = frame.getAttribute(RESIZE_KEY_ATTR);
  // Which handle: an object view has one per dimension — the one focused, or
  // the one whose dimension a keystroke from elsewhere in the embed stepped.
  const axis = document.activeElement?.closest(`[${RESIZE_HANDLE_ATTR}]`)?.getAttribute(RESIZE_AXIS_ATTR) ?? stepped;
  if (key) pendingFocus.set(root, { key, until: Date.now() + FOCUS_RESTORE_WINDOW_MS, axis: axis === 'width' || axis === 'height' ? axis : null });
}

function commit(root: HTMLElement, ops: EmbedResizeOps, target: Target, px: number | null): boolean {
  const t: Target = { ...target, frame: liveFrame(root, target.frame) };
  const content = ops.getContent();
  let next: string | null;
  if (t.kind === 'image') {
    const ref = imageRef(t.frame);
    next = ref ? applyImageSize(content, ref, px === null ? null : imageSizeForWidth(t.frame, px)) : null;
  } else {
    const line = Number(t.frame.dataset.fenceLine);
    next = Number.isFinite(line)
      ? (t.axis === 'width' ? applyObjectViewWidth : applyObjectViewHeight)(content, line, px)
      : null;
  }
  if (next === null || next === content) return false;
  if (t.frame.contains(document.activeElement)) rememberFocus(root, t.frame);
  ops.applyEdit(next);
  return true;
}

/** The target's size along its axis, as drawn now. */
function currentSize(t: Target): number {
  if (t.kind === 'image') return currentImageWidth(t.frame);
  return t.axis === 'width' ? currentViewWidth(t.frame) : currentViewHeight(t.frame);
}

/** Show the target at `px` (clamped), live, without writing; returns the size shown. */
function resizeTo(root: HTMLElement, t: Target, px: number): number {
  if (t.kind === 'image') {
    const w = clampImageWidth(t.frame, px);
    showImageSize(t.frame, w);
    return w;
  }
  if (t.axis === 'width') {
    const w = clampViewWidthIn(root, t.frame, px);
    showViewWidth(t.frame, w);
    return w;
  }
  const h = clampViewHeight(px);
  showViewHeight(t.frame, h);
  return h;
}

/** Reset an embed's height and width in one edit. */
function resetViewFrame(root: HTMLElement, ops: EmbedResizeOps, frame: HTMLElement): void {
  const live = liveFrame(root, frame);
  const line = Number(live.dataset.fenceLine);
  if (!Number.isFinite(line)) return;
  const content = ops.getContent();
  const noHeight = applyObjectViewHeight(content, line, null);
  const next = noHeight === null ? null : applyObjectViewWidth(noHeight, line, null);
  if (next !== null && next !== content) ops.applyEdit(next);
}

/**
 * Attach the controller to a preview element. Returns its teardown.
 */
export function installEmbedResize(root: HTMLElement, ops: EmbedResizeOps): () => void {
  let keyTimer: ReturnType<typeof setTimeout> | null = null;
  let keyTarget: { target: Target; px: number } | null = null;

  const flushKeys = () => {
    if (keyTimer) clearTimeout(keyTimer);
    keyTimer = null;
    const pending = keyTarget;
    keyTarget = null;
    if (pending) commit(root, ops, pending.target, pending.px);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const handle = (e.target as Element | null)?.closest<HTMLElement>(`[${RESIZE_HANDLE_ATTR}]`);
    const t = handle ? targetOf(handle) : null;
    if (!handle || !t) return;
    e.preventDefault();
    e.stopPropagation();
    flushKeys();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = currentSize(t);
    let px = start;
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic event: no capture */ }
    // The preview can re-render mid-drag (an autosave's rewrite, a graph
    // revision), replacing the frame and dropping the pointer capture with
    // it. So the drag listens on the window, not the handle, and each step
    // sizes whichever element now carries this frame's key.
    const live = (): HTMLElement => liveFrame(root, t.frame);
    live().classList.add('resizing');
    const onMove = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      const frame = live();
      px = resizeTo(root, { ...t, frame }, start + (t.axis === 'width' ? m.clientX - startX : m.clientY - startY));
    };
    const onEnd = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      try { handle.releasePointerCapture(u.pointerId); } catch { /* not captured */ }
      const frame = live();
      frame.classList.remove('resizing');
      if (u.type === 'pointercancel' || Math.round(px) === Math.round(start)) return;
      if (commit(root, ops, { ...t, frame }, Math.round(px))) announce(describe(t, px));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const onDblClick = (e: MouseEvent) => {
    const handle = (e.target as Element | null)?.closest(`[${RESIZE_HANDLE_ATTR}]`);
    const t = handle ? targetOf(handle) : null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    flushKeys();
    if (commit(root, ops, t, null)) announce(describe(t, null));
  };

  // A handle inside a link (`[![a](x)](url)`) must not follow it, and no
  // click on one should reach the preview's click routing.
  const onClickCapture = (e: MouseEvent) => {
    if ((e.target as Element | null)?.closest(`[${RESIZE_HANDLE_ATTR}]`)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as Element | null;
    if (e.metaKey || e.ctrlKey) return;
    const onHandle = !!el?.closest(`[${RESIZE_HANDLE_ATTR}]`);
    if (!e.altKey && !onHandle) return;
    if (e.altKey && (e.key === '0' || e.code === 'Digit0')) {
      const t = targetOf(el);
      if (!t) return;
      e.preventDefault();
      if (keyTimer) clearTimeout(keyTimer);
      keyTimer = null;
      keyTarget = null;
      rememberFocus(root, t.frame);
      if (t.kind === 'object-view' && !onHandle) {
        // Away from a handle there's no one dimension in focus: reset both.
        resetViewFrame(root, ops, t.frame);
        announce('View size reset');
        return;
      }
      commit(root, ops, t, null);
      announce(describe(t, null));
      return;
    }
    const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    // With Alt, the arrow picks the dimension (←/→ width, ↑/↓ height); on a
    // handle without it, every arrow steps that handle's own dimension.
    const t = e.altKey && el
      ? targetOf(el.closest(`[${RESIZE_KIND_ATTR}]`), horizontal ? 'width' : 'height')
      : targetOf(el);
    if (!t) return;
    e.preventDefault();
    // Focus is on this frame now; a re-render before the write lands (a save
    // of an earlier edit) would otherwise drop it.
    rememberFocus(root, t.frame, t.axis);
    if (keyTarget && (keyTarget.target.frame.getAttribute(RESIZE_KEY_ATTR) !== t.frame.getAttribute(RESIZE_KEY_ATTR)
      || keyTarget.target.axis !== t.axis)) flushKeys();
    const step = t.kind === 'image' ? IMAGE_STEP_PX : VIEW_STEP_PX;
    const px = resizeTo(root, t, Math.round(currentSize(t)) + dir * step);
    announce(describe(t, px));
    keyTarget = { target: t, px };
    if (keyTimer) clearTimeout(keyTimer);
    keyTimer = setTimeout(flushKeys, KEYBOARD_COMMIT_DELAY_MS);
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('dblclick', onDblClick);
  root.addEventListener('click', onClickCapture, true);
  root.addEventListener('keydown', onKeyDown);
  return () => {
    flushKeys();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('dblclick', onDblClick);
    root.removeEventListener('click', onClickCapture, true);
    root.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * After a re-render, put focus back on the handle the user was resizing with
 * the keyboard — the write replaced the element that had it.
 */
export function restoreResizeFocus(root: HTMLElement): void {
  const pending = pendingFocus.get(root);
  if (!pending) return;
  if (Date.now() > pending.until) {
    pendingFocus.delete(root);
    return;
  }
  const active = document.activeElement;
  // The user has moved on to something else that's still on screen: leave it.
  const activeKey = active?.closest(`[${RESIZE_KEY_ATTR}]`)?.getAttribute(RESIZE_KEY_ATTR) ?? null;
  if (active && active !== document.body && active.isConnected && activeKey !== pending.key) {
    pendingFocus.delete(root);
    return;
  }
  const frame = root.querySelector<HTMLElement>(`[${RESIZE_KEY_ATTR}="${CSS.escape(pending.key)}"]`);
  const handle = frame ? (pending.axis && handleOf(frame, pending.axis)) || handleOf(frame) : null;
  if (handle && handle !== active) handle.focus({ preventScroll: true });
}
