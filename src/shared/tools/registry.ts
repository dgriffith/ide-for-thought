import type { ThinkingToolDef, ThinkingToolInfo, ThinkingToolMeta, ToolCategory } from './types';

/**
 * Cross-process tool registry (#675).
 *
 * `tools` below is module-global mutable state. An ES module is a singleton
 * *per process*, and main and renderer are separate processes — so each gets
 * its OWN independent copy of this Map. That duplication is by design:
 *
 *  - **Main** populates it from compiled skills (`skills/register.ts`) with full
 *    `ThinkingToolDef`s, including the prompt bodies the executor needs.
 *  - **Renderer** populates ITS copy (`renderer/lib/tools/tool-registry.ts`)
 *    from `api.skills.list()` — serializable `SkillInfo` only. The renderer
 *    never receives prompt bodies (see CLAUDE.md "Tools for Thought"); its
 *    registry exists so menus / the command palette / right-click can list and
 *    dispatch tools without a round-trip.
 *
 * The two copies are populated from different sources and never share state at
 * runtime; "register once in each process at startup" is the contract.
 *
 * The map is typed `ThinkingToolMeta` — the half both processes really have
 * (#2235). Main registers full `ThinkingToolDef`s (a `Def` IS a `Meta`), and
 * reaches the builders back through `getToolDef` below; the renderer has
 * nothing to reach for, and now cannot pretend otherwise. Before the split both
 * were typed `ThinkingToolDef`, so the renderer supplied a `buildPrompt` stub
 * returning '' and any renderer call to it type-checked and silently produced
 * an empty prompt.
 *
 * Caveat for tests: because the Map is process-global, a test that registers
 * tools mutates a singleton shared with every other test in the same worker —
 * register into a clean state and clear up front (`unregisterTool` / re-register)
 * rather than assuming an empty registry.
 */
const tools = new Map<string, ThinkingToolMeta>();

export function registerTool(tool: ThinkingToolMeta): void {
  tools.set(tool.id, tool);
}

/** Remove a registered tool. Used to re-sync compiled skills on reload (#625). */
export function unregisterTool(id: string): void {
  tools.delete(id);
}

export function getTool(id: string): ThinkingToolMeta | undefined {
  return tools.get(id);
}

/**
 * The runnable definition for `id`, or undefined when this process only has
 * metadata for it (#2235).
 *
 * The check is at runtime, not a cast: in main every registered tool is a full
 * `ThinkingToolDef`, so this always resolves — but a cast would re-create
 * exactly the lie the split removed, handing back something typed as callable
 * on the strength of an assertion. Renderer code calling this gets `undefined`
 * and has to deal with it, rather than an empty prompt it never notices.
 */
export function getToolDef(id: string): ThinkingToolDef | undefined {
  const tool = tools.get(id);
  return tool && typeof (tool as ThinkingToolDef).buildPrompt === 'function'
    ? (tool as ThinkingToolDef)
    : undefined;
}

export function getToolsByCategory(category: ToolCategory): ThinkingToolMeta[] {
  return [...tools.values()].filter(t => t.category === category);
}

export function getAllTools(): ThinkingToolMeta[] {
  return [...tools.values()];
}

export function getToolInfosByCategory(category: ToolCategory): ThinkingToolInfo[] {
  return getToolsByCategory(category).map(toInfo);
}

export function getAllToolInfos(): ThinkingToolInfo[] {
  return getAllTools().map(toInfo);
}

export function getToolBySlashCommand(cmd: string): ThinkingToolMeta | undefined {
  const normalized = cmd.startsWith('/') ? cmd : `/${cmd}`;
  return [...tools.values()].find(t => t.slashCommand === normalized);
}

export function getSlashCommands(): ThinkingToolInfo[] {
  return [...tools.values()]
    .filter(t => t.slashCommand)
    .map(toInfo);
}

/**
 * Strip a registered tool down to something structured-cloneable (#2235).
 *
 * This used to destructure `buildPrompt` alone, which was right when
 * `buildPrompt` was the only builder and wrong from the moment
 * `skills/compile.ts` began attaching `buildSystemPrompt` / `buildFirstMessage`
 * to every `openConversation` skill: the rest spread them straight through, so
 * the result claimed to be function-free and wasn't. Nothing sent one across
 * the bridge yet, so nobody had seen the `DataCloneError` — the first handler
 * to try would have hit it on conversational skills only, against a signature
 * promising a clean payload.
 *
 * Deleting all three by name (rather than filtering on `typeof === 'function'`)
 * keeps this honest in the other direction too: add a fourth builder to
 * `ThinkingToolDef` and `tsc` flags this function, instead of it silently doing
 * the right thing and leaving the next one to chance.
 */
function toInfo(tool: ThinkingToolMeta): ThinkingToolInfo {
  const {
    buildPrompt: _p,
    buildSystemPrompt: _s,
    buildFirstMessage: _f,
    requiresTools: _r,
    ...info
  } = tool as ThinkingToolDef;
  return info;
}

export const CATEGORIES: { id: ToolCategory; label: string }[] = [
  { id: 'learning', label: 'Learning' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'research', label: 'Research' },
];
