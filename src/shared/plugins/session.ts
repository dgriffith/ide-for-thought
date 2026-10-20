/**
 * What crosses between main and the renderer about a plugin session (#2825).
 * The plugin itself never sees these; it speaks `api.ts` over its port.
 */

/** Something a plugin asked its window to do (the `ui` capability). */
export type PluginIntent =
  | { kind: 'openNote'; path: string }
  | { kind: 'announce'; text: string };

export interface PluginIntentEvent {
  sessionId: string;
  pluginId: string;
  intent: PluginIntent;
}

/** The window message the preload posts a session's port with (`event.ports[0]`). */
export const PLUGIN_SESSION_PORT_MESSAGE = 'minerva.plugin-session-port';
