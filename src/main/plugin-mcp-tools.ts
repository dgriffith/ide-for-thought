/**
 * A plugin's MCP tool, run for one of its contributions (#2880, #2879): an
 * ingestor's parser, an exporter's writer or a command, written as a tool on
 * one of the plugin's own servers (#2646) rather than code in its worker. For
 * anything that needs the network or a library of its own.
 *
 * - **Its own servers only.** `mcpTool` is `"<server key>/<tool>"`, the key
 *   one of the plugin's `mcpServers`, so a contribution can't reach another
 *   plugin's server or one the user configured.
 * - **The same gate as the conversation's `mcp_call`** (#2439):
 *   `callServerTool` runs only a tool the server advertised, and one not
 *   marked read-only asks first. Outside a conversation there's no card, so
 *   main asks with its own dialog (`nativeMcpConfirmer`), showing the exact
 *   arguments, with "Don't ask again for this tool" writing the same grant
 *   the card does. A renderer can't draw or answer it.
 * - **The tool answers JSON**, as the text of its result, and the caller
 *   checks it as it would a handler's answer: a source draft, export files,
 *   a command's result.
 */
import { BrowserWindow } from 'electron';
import { callServerTool, type McpCallConfirmer } from './mcp-servers/registry';
import { confirmNative } from './native-confirm';
import { PluginCallError } from './plugins/broker';
import { PLUGIN_MCP_TOOL } from '../shared/plugins/format';

/** The most text a tool's answer may be: an export's files travel in it. */
export const PLUGIN_TOOL_ANSWER_MAX_CHARS = 16 * 1024 * 1024;

/**
 * Ask natively before a tool that isn't read-only runs, in `win` (or the
 * focused window). "Don't ask again" is the card's grant: this tool, on this
 * server as it's configured now.
 */
export function nativeMcpConfirmer(win?: BrowserWindow | null): McpCallConfirmer {
  return async (req) => {
    const what = req.title ?? req.toolName;
    const { confirmed, checked } = await confirmNative(win ?? BrowserWindow.getFocusedWindow(), {
      message: `Let ${req.serverName} run ${what}?`,
      detail: [
        ...(req.description ? [req.description] : []),
        ...(req.destructiveHint ? ['The server says this tool may change or delete things.'] : []),
        `It's sent exactly this:\n${req.argsJson}`,
      ].join('\n\n'),
      confirmLabel: 'Run',
      checkboxLabel: 'Don\'t ask again for this tool',
    });
    return confirmed ? { allow: true, remember: checked } : { allow: false, reason: 'denied' };
  };
}

/**
 * Call `mcpTool` on plugin `pluginId`'s own server with `args`, asking natively
 * first if it isn't read-only, and answer the JSON it returns. Rejects naming
 * the plugin when the server isn't on, the user declines, or the tool fails.
 */
export async function callPluginTool(pluginName: string, pluginId: string, mcpTool: string, args: Record<string, unknown>, win?: BrowserWindow | null): Promise<unknown> {
  const m = PLUGIN_MCP_TOOL.exec(mcpTool);
  if (!m) throw new PluginCallError(`${pluginName} names "${mcpTool}", which isn't one of its tools.`);
  const [, key, tool] = m;
  let outcome;
  try {
    outcome = await callServerTool(`${pluginId}.${key}`, tool!, args, nativeMcpConfirmer(win));
  } catch (e) {
    // Not connected (turned off in Settings → MCP Servers, or not approved yet), or no such tool.
    throw new PluginCallError(`${pluginName}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (outcome.kind === 'declined') throw new PluginCallError(`${pluginName}'s ${tool} wasn't run: you didn't allow it.`);
  const text = outcome.result.content.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('');
  if (outcome.result.isError) throw new PluginCallError(`${pluginName}'s ${tool} failed: ${text.slice(0, 500) || 'it said only that it failed'}`);
  if (text.length > PLUGIN_TOOL_ANSWER_MAX_CHARS) throw new PluginCallError(`${pluginName}'s ${tool} answered more than ${PLUGIN_TOOL_ANSWER_MAX_CHARS / 1024 / 1024} MB.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new PluginCallError(`${pluginName}'s ${tool} didn't answer JSON.`);
  }
}
