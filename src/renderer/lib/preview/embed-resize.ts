/**
 * Resizing images and object-view embeds in the preview (#2666).
 *
 * One delegated controller per preview element, driving the handles that
 * `embed-resize-markup.ts` emits:
 *
 * - **Drag** — pointer events with pointer capture, never HTML5 drag-and-drop
 *   (which suspends the renderer's reactivity on macOS Electron). The frame
 *   resizes live while dragging; releasing writes the size into the note.
 * - **Keyboard** — with focus on the handle (or anywhere inside the embed),
 *   Alt+arrows step the size and Alt+0 resets it. On the handle itself the
 *   plain arrows work too, as a slider's should. Each step is announced
 *   through the app's live region; the write waits for a short pause so a
 *   run of steps is one edit rather than one per key.
 * - **Double-click** on the handle resets to the default.
 *
 * A write is a plain text edit of the note — `applyImageSize` /
 * `applyObjectViewHeight` against the current content — handed to the host's
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
import { IMAGE_REF_ATTR, RESIZE_HANDLE_ATTR, RESIZE_KEY_ATTR, RESIZE_KIND_ATTR } from './embed-resize-markup';

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

/** How long after a write a re-render may still hand focus back. A write can
 *  cause more than one re-render (the edit itself, then the save's), and each
 *  replaces the focused handle. */
export const FOCUS_RESTORE_WINDOW_MS = 3000;

const pendingFocus = new WeakMap<HTMLElement, { key: string; until: number }>();

interface Target {
  frame: HTMLElement;
  kind: Kind;
}

function targetOf(el: Element | null): Target | null {
  const frame = el?.closest<HTMLElement>(`[${RESIZE_KIND_ATTR}]`) ?? null;
  if (!frame) return null;
  const kind = frame.getAttribute(RESIZE_KIND_ATTR);
  return kind === 'image' || kind === 'object-view' ? { frame, kind } : null;
}

/** The frame's source position — markup the image rule wrote, so it parses. */
function imageRef(frame: HTMLElement): ImageSourceRef | null {
  const raw = frame.getAttribute(IMAGE_REF_ATTR);
  return raw ? JSON.parse(raw) as ImageSourceRef : null;
}

const imgOf = (frame: HTMLElement) => frame.querySelector<HTMLImageElement>('img');
const blockOf = (frame: HTMLElement) => frame.querySelector<HTMLElement>('.object-view-block');
const handleOf = (frame: HTMLElement) => frame.querySelector<HTMLElement>(`[${RESIZE_HANDLE_ATTR}]`);

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
  setHandleValue(frame, height);
}

function setHandleValue(frame: HTMLElement, px: number): void {
  const h = handleOf(frame);
  if (!h) return;
  h.setAttribute('aria-valuenow', String(Math.round(px)));
  h.setAttribute('aria-valuetext', `${Math.round(px)} pixels`);
}

function describe(kind: Kind, px: number | null): string {
  if (kind === 'image') return px === null ? 'Image reset to its natural size' : `Image width ${Math.round(px)} pixels`;
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
function rememberFocus(root: HTMLElement, frame: HTMLElement): void {
  const key = frame.getAttribute(RESIZE_KEY_ATTR);
  if (key) pendingFocus.set(root, { key, until: Date.now() + FOCUS_RESTORE_WINDOW_MS });
}

function commit(root: HTMLElement, ops: EmbedResizeOps, target: Target, px: number | null): boolean {
  const t: Target = { frame: liveFrame(root, target.frame), kind: target.kind };
  const content = ops.getContent();
  let next: string | null;
  if (t.kind === 'image') {
    const ref = imageRef(t.frame);
    next = ref ? applyImageSize(content, ref, px === null ? null : imageSizeForWidth(t.frame, px)) : null;
  } else {
    const line = Number(t.frame.dataset.fenceLine);
    next = Number.isFinite(line) ? applyObjectViewHeight(content, line, px) : null;
  }
  if (next === null || next === content) return false;
  if (t.frame.contains(document.activeElement)) rememberFocus(root, t.frame);
  ops.applyEdit(next);
  return true;
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
    const start = t.kind === 'image' ? currentImageWidth(t.frame) : currentViewHeight(t.frame);
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
      if (t.kind === 'image') {
        px = clampImageWidth(frame, start + (m.clientX - startX));
        showImageSize(frame, px);
      } else {
        px = clampViewHeight(start + (m.clientY - startY));
        showViewHeight(frame, px);
      }
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
      if (commit(root, ops, { frame, kind: t.kind }, Math.round(px))) announce(describe(t.kind, px));
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
    if (commit(root, ops, t, null)) announce(describe(t.kind, null));
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
    const t = targetOf(el);
    if (!t || e.metaKey || e.ctrlKey) return;
    const onHandle = !!el?.closest(`[${RESIZE_HANDLE_ATTR}]`);
    if (!e.altKey && !onHandle) return;
    if (e.altKey && (e.key === '0' || e.code === 'Digit0')) {
      e.preventDefault();
      if (keyTimer) clearTimeout(keyTimer);
      keyTimer = null;
      keyTarget = null;
      rememberFocus(root, t.frame);
      commit(root, ops, t, null);
      announce(describe(t.kind, null));
      return;
    }
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    // Focus is on this frame now; a re-render before the write lands (a save
    // of an earlier edit) would otherwise drop it.
    rememberFocus(root, t.frame);
    if (keyTarget && keyTarget.target.frame.getAttribute(RESIZE_KEY_ATTR) !== t.frame.getAttribute(RESIZE_KEY_ATTR)) flushKeys();
    let px: number;
    if (t.kind === 'image') {
      px = clampImageWidth(t.frame, Math.round(currentImageWidth(t.frame)) + dir * IMAGE_STEP_PX);
      showImageSize(t.frame, px);
    } else {
      px = clampViewHeight(currentViewHeight(t.frame) + dir * VIEW_STEP_PX);
      showViewHeight(t.frame, px);
    }
    announce(describe(t.kind, px));
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
  const handle = frame ? handleOf(frame) : null;
  if (handle && handle !== active) handle.focus({ preventScroll: true });
}
