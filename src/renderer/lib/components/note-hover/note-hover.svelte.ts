/**
 * The open/close state behind `NoteHoverPreview` (#2710): which item's preview
 * shows, when it opens, and when it goes. One per host (a view, the Preview
 * pane), shared by its items.
 *
 * - **Pointer.** Resting on an item opens its preview after
 *   `NOTE_HOVER_OPEN_DELAY_MS` — the editor's link hover delay (#1131), so a
 *   pointer passing over a board doesn't flash a preview per card. Leaving the
 *   item closes it after `NOTE_HOVER_CLOSE_GRACE_MS`, and moving onto the
 *   preview in that time keeps it open (the Preview pane's broken-link grace,
 *   #1446): the preview never traps the pointer, and never vanishes from
 *   under it either.
 * - **Keyboard focus** opens the focused item's preview at once, and blur
 *   closes it. A hover wins over focus while it lasts; when it ends, the
 *   focused item's preview comes back.
 * - **Escape** closes both, until the next hover or focus.
 *
 * Nothing here takes focus or touches the DOM; the component does the
 * placement and the listening.
 */

/** Resting time before a hovered item's preview opens — the editor's (#1131). */
export const NOTE_HOVER_OPEN_DELAY_MS = 250;
/** Time to cross from an item onto its preview before it closes (#1446). */
export const NOTE_HOVER_CLOSE_GRACE_MS = 180;

export interface NoteHoverSubject {
  /** The item's identity — a note path, or a link's target. */
  key: string;
  /** What to preview: a wiki-link target or a note's path (`makeNotePreviewFetcher`). */
  target: string;
  /** The element the preview is placed against. */
  anchor: Element;
  /** Shown while the note loads, and if it can't be read — a view knows its item's title. */
  fallbackTitle?: string;
}

export interface NoteHover {
  /** The subject whose preview shows: the hovered item, else the focused one. */
  readonly current: NoteHoverSubject | null;
  pointerEnter(subject: NoteHoverSubject): void;
  pointerLeave(key: string): void;
  focus(subject: NoteHoverSubject): void;
  blur(key: string): void;
  /** The pointer moved onto / off the preview itself. */
  previewEnter(): void;
  previewLeave(): void;
  /** Escape, a click, the anchor going away: close whatever shows. */
  close(): void;
  /** Cancel the timers (the host is going away). */
  dispose(): void;
}

export function createNoteHover(opts: { openDelayMs?: number; closeGraceMs?: number } = {}): NoteHover {
  const openDelay = opts.openDelayMs ?? NOTE_HOVER_OPEN_DELAY_MS;
  const closeGrace = opts.closeGraceMs ?? NOTE_HOVER_CLOSE_GRACE_MS;
  let hovered = $state<NoteHoverSubject | null>(null);
  let focused = $state<NoteHoverSubject | null>(null);
  let pending: NoteHoverSubject | null = null;
  let overPreview = false;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelOpen(): void {
    if (openTimer !== null) clearTimeout(openTimer);
    openTimer = null;
    pending = null;
  }
  function cancelClose(): void {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
  }
  function scheduleClose(): void {
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!overPreview) hovered = null;
    }, closeGrace);
  }

  return {
    get current() { return hovered ?? focused; },
    pointerEnter(subject) {
      cancelClose();
      if (hovered?.key === subject.key || pending?.key === subject.key) return;
      cancelOpen();
      pending = subject;
      openTimer = setTimeout(() => {
        openTimer = null;
        pending = null;
        hovered = subject;
      }, openDelay);
    },
    pointerLeave(key) {
      if (pending?.key === key) cancelOpen();
      if (hovered?.key === key) scheduleClose();
    },
    focus(subject) { focused = subject; },
    blur(key) { if (focused?.key === key) focused = null; },
    previewEnter() {
      overPreview = true;
      cancelClose();
    },
    previewLeave() {
      overPreview = false;
      if (hovered) scheduleClose();
    },
    close() {
      cancelOpen();
      cancelClose();
      overPreview = false;
      hovered = null;
      focused = null;
    },
    dispose() {
      cancelOpen();
      cancelClose();
    },
  };
}
