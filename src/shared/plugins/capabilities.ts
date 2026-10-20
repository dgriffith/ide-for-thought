/**
 * What plugin code may do, by name (#2823, design docs/plugin-code.md → What
 * it can reach). A plugin declares the capabilities it uses under
 * `code.capabilities` in plugin.json; anything not declared, the host refuses.
 * The list is closed: a name not here refuses the plugin, so a misspelt
 * capability can't quietly grant nothing, or something else.
 *
 * The tier is what agreeing to it costs:
 * - **A** reads, and asks the app to do things it draws itself;
 * - **B** changes notes, scoped to the notes the plugin was given;
 * - **C** runs a program on this machine. Turning on any plugin that declares
 *   one asks with main's own dialog, built-in or not (#2821).
 *
 * Never a capability, for any plugin: the network (that's an MCP server),
 * secrets, the file system, `window.api`, and the approval engine.
 */
export const PLUGIN_CAPABILITIES = {
  'notes:read': { tier: 'A', describes: 'read the notes Minerva hands its views and commands' },
  'graph:query': { tier: 'A', describes: 'run read-only queries over the graph and tables' },
  ui: { tier: 'A', describes: 'open notes, show menus and make announcements' },
  'notes:write-properties': { tier: 'B', describes: 'change the properties of notes it was given' },
  'notes:write': { tier: 'B', describes: 'create notes, and change the notes it was given' },
  'llm:propose': { tier: 'B', describes: 'ask the assistant for changes, which you review as proposals' },
  process: { tier: 'C', describes: 'run a program on this machine' },
} as const satisfies Record<string, { tier: 'A' | 'B' | 'C'; describes: string }>;

export type PluginCapability = keyof typeof PLUGIN_CAPABILITIES;
export type PluginCapabilityTier = (typeof PLUGIN_CAPABILITIES)[PluginCapability]['tier'];

export function isPluginCapability(name: string): name is PluginCapability {
  return Object.hasOwn(PLUGIN_CAPABILITIES, name);
}

/** What a plugin with these capabilities can do, in a sentence: "It can …". */
export function describeCapabilities(caps: readonly PluginCapability[]): string {
  const parts = caps.map((c) => PLUGIN_CAPABILITIES[c].describes);
  if (parts.length === 0) return '';
  // Semicolons, because a description may hold an "and" of its own.
  const list = parts.length === 1 ? parts[0]!
    : parts.length === 2 ? `${parts[0]!}; and ${parts[1]!}`
      : `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]!}`;
  return `It can ${list}.`;
}
