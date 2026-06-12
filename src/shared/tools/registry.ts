import type { ThinkingToolDef, ThinkingToolInfo, ToolCategory } from './types';

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
 * Caveat for tests: because the Map is process-global, a test that registers
 * tools mutates a singleton shared with every other test in the same worker —
 * register into a clean state and clear up front (`unregisterTool` / re-register)
 * rather than assuming an empty registry.
 */
const tools = new Map<string, ThinkingToolDef>();

export function registerTool(tool: ThinkingToolDef): void {
  tools.set(tool.id, tool);
}

/** Remove a registered tool. Used to re-sync compiled skills on reload (#625). */
export function unregisterTool(id: string): void {
  tools.delete(id);
}

export function getTool(id: string): ThinkingToolDef | undefined {
  return tools.get(id);
}

export function getToolsByCategory(category: ToolCategory): ThinkingToolDef[] {
  return [...tools.values()].filter(t => t.category === category);
}

export function getAllTools(): ThinkingToolDef[] {
  return [...tools.values()];
}

export function getToolInfosByCategory(category: ToolCategory): ThinkingToolInfo[] {
  return getToolsByCategory(category).map(toInfo);
}

export function getAllToolInfos(): ThinkingToolInfo[] {
  return getAllTools().map(toInfo);
}

export function getToolBySlashCommand(cmd: string): ThinkingToolDef | undefined {
  const normalized = cmd.startsWith('/') ? cmd : `/${cmd}`;
  return [...tools.values()].find(t => t.slashCommand === normalized);
}

export function getSlashCommands(): ThinkingToolInfo[] {
  return [...tools.values()]
    .filter(t => t.slashCommand)
    .map(toInfo);
}

function toInfo(tool: ThinkingToolDef): ThinkingToolInfo {
  const { buildPrompt: _, ...info } = tool;
  return info;
}

export const CATEGORIES: { id: ToolCategory; label: string }[] = [
  { id: 'learning', label: 'Learning' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'research', label: 'Research' },
];
