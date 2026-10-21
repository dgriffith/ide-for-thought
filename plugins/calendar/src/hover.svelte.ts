/**
 * The calendar's hover preview (#2713), as a plugin (#2829): the same small
 * interface the day list and bands were written against — the app's
 * `note-hover` controller's — but the preview itself is the app's own,
 * asked for with `ui.previewNote` (the event's dates as extra lines, the
 * dates left off its field strip) and let go with `ui.hidePreview`. Minerva
 * sends the preview's text back as a `preview` event; `description` holds it,
 * so the item can be described inside the frame, where the app's tooltip
 * can't be pointed at.
 */
import type { MinervaPlugin } from '/@minerva/plugin-api.js';

export interface NoteHoverSubject {
  key: string;
  target: string;
  anchor: Element;
  fallbackTitle?: string;
}

export interface NoteHover {
  /** The item a preview is up for (hovered, else focused), or null. */
  readonly current: { key: string } | null;
  pointerEnter(subject: NoteHoverSubject): void;
  pointerLeave(key: string): void;
  focus(subject: NoteHoverSubject): void;
  blur(key: string): void;
  /** Escape, a click, a drag starting: let whatever shows go. */
  close(): void;
}

export interface PluginHover extends NoteHover {
  /** The preview's text, for the item it describes; null when none is up. */
  readonly description: { path: string; text: string } | null;
  /** Stop listening (the calendar is going away). */
  dispose(): void;
}

export function createPluginHover(
  minerva: MinervaPlugin,
  opts: { enabled: () => boolean; extra: (key: string) => string[]; omit: () => string[] },
): PluginHover {
  let hovered = $state<string | null>(null);
  let focused = $state<string | null>(null);
  let description = $state<{ path: string; text: string } | null>(null);
  const quietly = (p: Promise<unknown>) => { p.catch(() => {}); };

  function ask(subject: NoteHoverSubject, via: 'pointer' | 'focus'): void {
    if (!opts.enabled()) return;
    const r = subject.anchor.getBoundingClientRect();
    quietly(minerva.ui.previewNote({
      path: subject.key, x: r.left, y: r.top, width: r.width, height: r.height, via,
      extra: opts.extra(subject.key), omit: opts.omit(),
    }));
  }
  function letGo(key: string, via: 'pointer' | 'focus'): void {
    quietly(minerva.ui.hidePreview({ path: key, via }));
  }
  const stop = minerva.on('preview', ({ path, description: text }) => {
    description = text === null ? (description?.path === path ? null : description) : { path, text };
  });

  return {
    get current() {
      const key = hovered ?? focused;
      return key === null ? null : { key };
    },
    get description() { return description; },
    pointerEnter(subject) { hovered = subject.key; ask(subject, 'pointer'); },
    pointerLeave(key) { if (hovered === key) hovered = null; if (opts.enabled()) letGo(key, 'pointer'); },
    focus(subject) { focused = subject.key; ask(subject, 'focus'); },
    blur(key) { if (focused === key) focused = null; if (opts.enabled()) letGo(key, 'focus'); },
    close() {
      for (const [key, via] of [[hovered, 'pointer'], [focused, 'focus']] as const) if (key !== null) letGo(key, via);
      hovered = null;
      focused = null;
    },
    dispose() { stop(); },
  };
}
