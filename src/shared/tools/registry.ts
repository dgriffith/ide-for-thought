import type { ThinkingToolDef, ThinkingToolInfo, ToolCategory } from './types';

const tools = new Map<string, ThinkingToolDef>();

export function registerTool(tool: ThinkingToolDef): void {
  tools.set(tool.id, tool);
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
