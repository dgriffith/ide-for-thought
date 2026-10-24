/**
 * What crosses between main and the renderer about a plugin session (#2825).
 * The plugin itself never sees these; it speaks `api.ts` over its port.
 */

import type { PluginMoveTarget, PluginViewState } from './api';

/** Something a plugin asked its window to do (the `ui` capability). */
export type PluginIntent =
  | { kind: 'openNote'; path: string }
  | { kind: 'announce'; text: string }
  | { kind: 'revealNote'; path: string }
  /** Give focus back to the app: the host moves it to the frame's container (#2827). */
  | { kind: 'releaseFocus' }
  /** A shortcut the view didn't handle; the host runs it only if it may (#2827). */
  | { kind: 'key'; key: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }
  /** Change the view's own spec (#2828); the host keeps only its layout's fields. */
  | { kind: 'setViewState'; patch: Record<string, unknown> }
  /** The app's own note menu, for notes the session was given, at a point in the frame (#2828). */
  | { kind: 'showNoteMenu'; paths: string[]; x: number; y: number; target: boolean; label: string | null }
  /** The app's hover preview, beside a box in the frame (#2828). */
  | { kind: 'previewNote'; path: string; rect: { x: number; y: number; width: number; height: number }; via: 'pointer' | 'focus'; extra: string[]; omit: string[] }
  | { kind: 'hidePreview'; path: string; via: 'pointer' | 'focus' }
  /** The plugin's answer to an export request: unsanitized HTML — the host sanitizes it (#2828). */
  | { kind: 'exportHtml'; requestId: string; html: string }
  /** The view's own selection (#2828): a click on a note, ⌘A, Escape. */
  | { kind: 'viewClick'; path: string; meta: boolean; ctrl: boolean; shift: boolean }
  | { kind: 'selectAll' }
  | { kind: 'clearSelection' }
  /** A board's moves (#2828, decision 2): the host moves, with its own undo. */
  | { kind: 'moveCard'; path: string; target: PluginMoveTarget }
  | { kind: 'undoMove' }
  | { kind: 'moveColumn'; key: string; target: string; side: 'before' | 'after' }
  | { kind: 'reschedule'; path: string; days: number };

/** What the host tells main to pass on to a session's plugin (#2827). */
export type PluginHostEvent =
  | { kind: 'theme'; mode: string; vars: Record<string, string> }
  | { kind: 'drop'; paths: string[]; x: number; y: number }
  /** A type view's state, for a plugin drawing its layout (#2828). */
  | { kind: 'view'; state: PluginViewState }
  /** Ask the plugin to draw its view for an export (#2828). */
  | { kind: 'exportRequest'; requestId: string }
  /** What the app's hover preview of a note says, or null when it goes (#2828). */
  | { kind: 'preview'; path: string; description: string | null };

export interface PluginIntentEvent {
  sessionId: string;
  pluginId: string;
  intent: PluginIntent;
}

/** The window message the preload posts a session's port with (`event.ports[0]`). */
export const PLUGIN_SESSION_PORT_MESSAGE = 'minerva.plugin-session-port';
