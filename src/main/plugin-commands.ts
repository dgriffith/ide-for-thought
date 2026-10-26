/**
 * Running a plugin's command (#2643, design `docs/plugin-code.md` →
 * *Commands*). The renderer says which command, and what it runs on — the
 * active note and the selected text — and gets back what to do. Everything
 * between is decided here, from the manifest:
 *
 * - a **handler** runs in the plugin's worker host (#2830) with the context
 *   as data and the active note as its whole scope; an **mcpTool** (#2879)
 *   runs on the plugin's own MCP server, handed the same, asking first.
 *   Either answer is checked (`replaceSelection`, `announce`, nothing else)
 *   before the renderer sees it; the renderer applies the replacement as one
 *   undoable change, and only to the text that was selected when it ran;
 * - a **skill**, **query** or **view** is named back to the renderer, which
 *   runs it the way the palette always has. A query's text is read here, from
 *   the plugin's own folder.
 */
import { lexicalAgentPathRefusal } from './path-containment';
import { invokePluginLogic } from './plugin-worker-host';
import { callPluginTool } from './plugin-mcp-tools';
import { readDeclaredQuery } from './plugin-sessions';
import { codePluginCommands, codePluginIdentity } from './plugins/code-plugins';
import { PluginCallError } from './plugins/broker';
import { PLUGIN_MESSAGE_LIMIT_BYTES } from '../shared/plugins/api';
import type { PluginCommandAction, PluginCommandContext } from '../shared/plugins/format';

/** The longest announcement a command may make. */
export const PLUGIN_COMMAND_ANNOUNCE_MAX = 200;

/** What the handler is handed: the command, and what it runs on. */
export interface PluginCommandArgs {
  command: string;
  note: string | null;
  selection: string | null;
}

export async function runPluginCommand(rootPath: string, pluginId: string, commandId: string, ctx: PluginCommandContext): Promise<PluginCommandAction> {
  const identity = codePluginIdentity(pluginId);
  if (!identity) throw new PluginCallError(`"${pluginId}" is not an enabled plugin with code.`);
  const def = codePluginCommands(pluginId).find((c) => c.id === commandId);
  if (!def) throw new PluginCallError(`${identity.name} has no command "${commandId}".`);

  const note = typeof ctx.note === 'string' && ctx.note !== '' ? ctx.note : null;
  if (note !== null && lexicalAgentPathRefusal(note)) throw new PluginCallError(`"${def.title}" can't run on ${note}.`);
  const selection = typeof ctx.selection === 'string' && ctx.selection !== '' ? ctx.selection : null;
  if (selection !== null && Buffer.byteLength(selection) > PLUGIN_MESSAGE_LIMIT_BYTES / 2) {
    throw new PluginCallError(`The selection is too large for "${def.title}".`);
  }
  if (def.when !== 'project' && note === null) throw new PluginCallError(`"${def.title}" needs a note open.`);
  if (def.when === 'selection' && selection === null) throw new PluginCallError(`"${def.title}" needs text selected.`);

  const run = def.run;
  if ('skill' in run) return { kind: 'skill', skill: run.skill };
  if ('view' in run) return { kind: 'view', view: run.view };
  if ('query' in run) return { kind: 'query', text: await readDeclaredQuery(pluginId, run.query) };

  const args: PluginCommandArgs = { command: def.id, note, selection };
  // A handler in its worker, its note as its scope; or a tool on its own MCP
  // server (#2879), handed the same, which asks natively first unless it's
  // read-only. A tool can't read the note: it gets the path and the selection.
  const answer = 'handler' in run
    ? await invokePluginLogic(pluginId, run.handler, args, { rootPath, scope: note ? [note] : [] })
    : await callPluginTool(identity.name, pluginId, run.mcpTool, { ...args });
  return checkedResult(identity.name, def.title, answer);
}

/** A handler's answer as the renderer may act on it; anything else is the plugin's error. */
function checkedResult(name: string, title: string, answer: unknown): PluginCommandAction {
  if (answer === undefined || answer === null) return { kind: 'result' };
  const bad = () => new PluginCallError(`${name}: "${title}" returned something that isn't a command's result.`);
  if (typeof answer !== 'object' || Array.isArray(answer)) throw bad();
  const { replaceSelection, announce, ...rest } = answer as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw bad();
  if (replaceSelection !== undefined && typeof replaceSelection !== 'string') throw bad();
  if (announce !== undefined && (typeof announce !== 'string' || announce.length > PLUGIN_COMMAND_ANNOUNCE_MAX)) throw bad();
  return {
    kind: 'result',
    ...(replaceSelection !== undefined ? { replaceSelection } : {}),
    ...(announce ? { announce } : {}),
  };
}
