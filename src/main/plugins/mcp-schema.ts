/**
 * A plugin's `mcpServers` in `plugin.json` (#2646). Pure, and fail closed
 * like the rest of the manifest: every problem reported at once. Where the
 * program lives is checked against the folder in `package.ts`.
 */
import { PLUGIN_MCP_INTERPRETERS, type PluginMcpServer, type PluginSetting } from '../../shared/plugins/format';

const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SETTING_REF = /\$\{settings\.([A-Za-z][A-Za-z0-9_]*)\}/g;
const ALLOWED = new Set(['title', 'command', 'args', 'env']);
export const MCP_LIMITS = { servers: 8, args: 32, arg: 1000, env: 32, value: 2000 } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A path written in the manifest: relative, `/`-separated, no `..`, and not
 * starting with `-`, so an interpreter's "script" can't be a flag like
 * `node -e …`. Null when it isn't one.
 */
export function pluginRelativePath(written: string): string | null {
  if (written.includes('\\') || written.startsWith('/') || written.startsWith('-') || /^[A-Za-z]:/.test(written)) return null;
  const segments = written.split('/').filter((s) => s !== '.');
  if (segments.length === 0 || segments.some((s) => s === '' || s === '..')) return null;
  return segments.join('/');
}

export function isInterpreter(command: string): boolean {
  return (PLUGIN_MCP_INTERPRETERS as readonly string[]).includes(command);
}

/** The settings an env value names. */
export function settingRefs(value: string): string[] {
  return [...value.matchAll(SETTING_REF)].map((m) => m[1]!);
}

export function validatePluginMcpServers(raw: unknown, settings: readonly PluginSetting[], problems: string[]): PluginMcpServer[] {
  if (!isRecord(raw)) {
    problems.push('"mcpServers" must be an object of server name → { command, args, env }.');
    return [];
  }
  const entries = Object.entries(raw);
  if (entries.length > MCP_LIMITS.servers) problems.push(`"mcpServers" has ${entries.length} servers; at most ${MCP_LIMITS.servers}.`);
  const settingKeys = new Set(settings.map((s) => s.key));
  const out: PluginMcpServer[] = [];
  for (const [key, spec] of entries.slice(0, MCP_LIMITS.servers)) {
    const at = `"mcpServers.${key}"`;
    const before = problems.length;
    if (!KEY.test(key)) problems.push(`${at}: a server's name must be letters, digits, "-" and "_".`);
    if (!isRecord(spec)) { problems.push(`${at} must be an object like { "command": "node", "args": ["server.js"] }.`); continue; }
    for (const k of Object.keys(spec)) if (!ALLOWED.has(k)) problems.push(`${at}: unknown field "${k}".`);

    const title = spec.title === undefined ? key
      : typeof spec.title === 'string' && spec.title.trim() && spec.title.length <= 80 ? spec.title.trim() : null;
    if (title === null) problems.push(`${at}: "title" must be a name of at most 80 characters.`);

    const command = typeof spec.command === 'string' ? spec.command : '';
    if (!isInterpreter(command) && pluginRelativePath(command) === null) {
      problems.push(`${at}: "command" must be a file in the plugin folder (like "bin/server") or one of ${PLUGIN_MCP_INTERPRETERS.join(', ')}.`);
    }

    const args = spec.args === undefined ? [] : spec.args;
    if (!Array.isArray(args) || args.length > MCP_LIMITS.args || !args.every((a) => typeof a === 'string' && a.length <= MCP_LIMITS.arg)) {
      problems.push(`${at}: "args" must be a list of at most ${MCP_LIMITS.args} strings.`);
    } else if (isInterpreter(command) && (typeof args[0] !== 'string' || pluginRelativePath(args[0]) === null)) {
      problems.push(`${at}: with "${command}", the first argument must be the script, a file in the plugin folder.`);
    }

    const env: Record<string, string> = {};
    if (spec.env !== undefined) {
      if (!isRecord(spec.env) || Object.keys(spec.env).length > MCP_LIMITS.env) {
        problems.push(`${at}: "env" must be an object of at most ${MCP_LIMITS.env} NAME → value.`);
      } else {
        for (const [name, value] of Object.entries(spec.env)) {
          if (!ENV_NAME.test(name)) { problems.push(`${at}: "${name}" isn't an environment variable name.`); continue; }
          if (typeof value !== 'string' || value.length > MCP_LIMITS.value) { problems.push(`${at}: "env.${name}" must be a string.`); continue; }
          for (const ref of settingRefs(value)) {
            if (!settingKeys.has(ref)) problems.push(`${at}: "env.${name}" names the setting "${ref}", which the plugin doesn't declare.`);
          }
          env[name] = value;
        }
      }
    }
    if (problems.length === before) out.push({ key, title: title!, command, args: args as string[], env });
  }
  return out;
}
