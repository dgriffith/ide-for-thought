/**
 * What crosses between main and the renderer about a plugin session (#2825).
 * The plugin itself never sees these; it speaks `api.ts` over its port.
 */

/** Something a plugin asked its window to do (the `ui` capability). */
export type PluginIntent =
  | { kind: 'openNote'; path: string }
  | { kind: 'announce'; text: string }
  | { kind: 'revealNote'; path: string }
  /** Give focus back to the app: the host moves it to the frame's container (#2827). */
  | { kind: 'releaseFocus' }
  /** A shortcut the view didn't handle; the host runs it only if it may (#2827). */
  | { kind: 'key'; key: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean };

/** What the host tells main to pass on to a session's plugin (#2827). */
export type PluginHostEvent =
  | { kind: 'theme'; mode: string; vars: Record<string, string> }
  | { kind: 'drop'; paths: string[]; x: number; y: number };

export interface PluginIntentEvent {
  sessionId: string;
  pluginId: string;
  intent: PluginIntent;
}

/** The window message the preload posts a session's port with (`event.ports[0]`). */
export const PLUGIN_SESSION_PORT_MESSAGE = 'minerva.plugin-session-port';
